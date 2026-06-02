//! Async process-spawn engine (P3-T2).
//!
//! The execution core for Lane-A script buttons (and, later, the embedded
//! terminal). It owns a process-group-isolated child spawner that:
//!
//! 1. Spawns a child with **program + args only** — never `sh -c` / a shell
//!    string — under the hydrated login-shell environment ([`env::hydrated_env`]).
//! 2. Puts the child in its **own process group** (`setpgid(0,0)` via a unix
//!    `pre_exec`), so a cancel can signal the *whole* group (the Node script and
//!    anything it spawns) rather than just the immediate child.
//! 3. Streams the child's stdout and stderr line-by-line as Tauri events
//!    (`job://stdout`, `job://stderr`) and emits a final `job://exit` event with
//!    the exit code on completion. Each payload carries the `job_id`.
//! 4. Tracks every live job in a process-wide [`JobRegistry`] held in Tauri
//!    state, so [`cancel_job`] can terminate a group on demand and the app-exit
//!    hook can kill *all* jobs (no orphans).
//!
//! Cancellation kills the process group with `SIGTERM` (graceful), then removes
//! the entry from the registry. App exit calls [`JobRegistry::kill_all`].

use crate::commands::{CommandError, ErrorCode};
use crate::env;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

/// Monotonic job-id source. Job ids are `"job-{n}"` strings, unique per process.
static JOB_COUNTER: AtomicU64 = AtomicU64::new(1);

/// A handle to one spawned job, stored in the registry while the job is live.
///
/// Holds only the child's PID (which equals its process-group id, since the
/// child is the group leader after `setpgid(0,0)`). Ownership of the `Child`
/// lives entirely in the reaper thread, which blocks on `wait()`; the registry
/// keeps just the pid so [`cancel`](JobRegistry::cancel) / [`kill_all`]
/// (JobRegistry::kill_all) can signal the whole group without taking the child
/// out from under the waiter.
pub struct JobHandle {
    /// The child's PID, which equals its process-group id (it is the group
    /// leader). Signals are sent to `-pid` to hit the whole group.
    ///
    /// For a sequential batch job this is the PID of the *currently running*
    /// child; the runner updates it as it advances to the next URL.
    pub pid: u32,
    /// Set on cancel for a sequential batch job: the runner checks this flag
    /// between URLs and stops the loop (no further URLs spawned). `None` for a
    /// plain single-child job.
    pub cancel: Option<Arc<AtomicBool>>,
}

/// Process-wide registry of live jobs, held in Tauri managed state.
///
/// Wraps a `Mutex<HashMap<JobId, JobHandle>>`. Entries are inserted at spawn and
/// removed either when the job exits naturally (by the reaper thread) or when it
/// is cancelled / killed.
#[derive(Clone)]
pub struct JobRegistry {
    inner: Arc<Mutex<HashMap<String, JobHandle>>>,
}

impl Default for JobRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl JobRegistry {
    pub fn new() -> Self {
        JobRegistry {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Number of live jobs currently tracked (test/introspection helper).
    pub fn len(&self) -> usize {
        self.inner.lock().expect("registry lock").len()
    }

    /// Whether a job id is currently live in the registry.
    pub fn contains(&self, job_id: &str) -> bool {
        self.inner.lock().expect("registry lock").contains_key(job_id)
    }

    /// Insert a freshly spawned job.
    fn insert(&self, job_id: String, handle: JobHandle) {
        self.inner
            .lock()
            .expect("registry lock")
            .insert(job_id, handle);
    }

    /// Remove a job by id, returning its handle if it was still tracked.
    fn remove(&self, job_id: &str) -> Option<JobHandle> {
        self.inner.lock().expect("registry lock").remove(job_id)
    }

    /// Reserve a sequential batch job: register it with a cancel flag and a
    /// placeholder pid (0). The runner thread calls [`set_pid`](Self::set_pid)
    /// each time it spawns a child. Returns the shared cancel flag the runner
    /// polls between URLs.
    fn insert_sequential(&self, job_id: String) -> Arc<AtomicBool> {
        let cancel = Arc::new(AtomicBool::new(false));
        self.insert(
            job_id,
            JobHandle {
                pid: 0,
                cancel: Some(Arc::clone(&cancel)),
            },
        );
        cancel
    }

    /// Update the live pid of a still-tracked job (used by the sequential runner
    /// as it advances to the next child). No-op if the job was already removed
    /// (e.g. cancelled), preserving the existing cancel flag.
    fn set_pid(&self, job_id: &str, pid: u32) {
        if let Some(handle) = self.inner.lock().expect("registry lock").get_mut(job_id) {
            handle.pid = pid;
        }
    }

    /// Cancel a single job: kill its whole process group and drop it from the
    /// registry. A no-op (Ok) if the id is unknown / already gone.
    ///
    /// For a sequential batch job this also flips the cancel flag so the runner
    /// stops the loop (no further URLs are spawned) in addition to killing the
    /// currently-running child.
    ///
    /// The child is reaped by its own reaper thread, which unblocks from
    /// `wait()` as soon as the group is signalled — so no zombie is left and the
    /// reaper emits the final `job://exit` event.
    pub fn cancel(&self, job_id: &str) -> Result<(), CommandError> {
        if let Some(handle) = self.remove(job_id) {
            if let Some(flag) = &handle.cancel {
                flag.store(true, Ordering::SeqCst);
            }
            if handle.pid != 0 {
                kill_group(handle.pid);
            }
        }
        Ok(())
    }

    /// Kill ALL live jobs. Called from the app-exit hook so no child outlives the
    /// GUI. Drains the registry under the lock, then signals each group.
    pub fn kill_all(&self) {
        let drained: Vec<(String, JobHandle)> = {
            let mut guard = self.inner.lock().expect("registry lock");
            guard.drain().collect()
        };
        for (_id, handle) in drained {
            if let Some(flag) = &handle.cancel {
                flag.store(true, Ordering::SeqCst);
            }
            if handle.pid != 0 {
                kill_group(handle.pid);
            }
        }
    }
}

/// Event payload for a streamed output line.
#[derive(Debug, Clone, Serialize)]
struct LinePayload {
    job_id: String,
    line: String,
}

/// Event payload for job completion.
#[derive(Debug, Clone, Serialize)]
struct ExitPayload {
    job_id: String,
    /// The process exit code, or `None` if terminated by a signal.
    code: Option<i32>,
}

/// Allocate the next unique job id (`"job-{n}"`).
fn next_job_id() -> String {
    let n = JOB_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("job-{n}")
}

/// Send `SIGTERM` to the process group led by `pid`.
///
/// The child is the group leader (we ran `setpgid(0,0)` in its `pre_exec`), so
/// its PID is also its PGID. Signalling `-pid` (a negative pid) targets the
/// whole group, terminating the script and anything it spawned — no orphans.
#[cfg(unix)]
fn kill_group(pid: u32) {
    // Negative pid → "every process in the group whose id is |pid|".
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
}

#[cfg(not(unix))]
fn kill_group(_pid: u32) {
    // Non-unix: best-effort no-op for the group signal; the `Child::kill` in
    // `cancel`/`kill_all` handles the immediate child on those platforms.
}

/// Spawn a job: run `program` with `args` in `cwd`, under the hydrated
/// login-shell environment, in its own process group, streaming stdout/stderr
/// line-by-line as `job://stdout` / `job://stderr` events and a final
/// `job://exit` event. Returns the new job id immediately; output streams
/// asynchronously on background threads.
///
/// **Security:** `program` + `args` is an argv array — there is no shell, so
/// no `sh -c` string interpolation is ever performed.
///
/// Generic over the emitter so the streaming logic is unit-testable without a
/// full Tauri runtime (tests pass a channel-backed collector; production passes
/// the `AppHandle`).
pub fn spawn_job_with_emitter<E>(
    emitter: E,
    registry: &JobRegistry,
    program: &str,
    args: &[String],
    cwd: &Path,
) -> Result<String, CommandError>
where
    E: JobEmitter + Send + Sync + 'static,
{
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Run with the login-shell environment (PATH etc.), not the GUI-inherited one.
    env::hydrated_env().apply_to_command(&mut cmd);

    // Put the child in its own process group so cancel hits the whole group.
    #[cfg(unix)]
    {
        unsafe {
            cmd.pre_exec(|| {
                // setpgid(0, 0): the child becomes leader of a new group whose id
                // equals its own pid. Errors are non-fatal for the spawn.
                if libc::setpgid(0, 0) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    let mut child = cmd.spawn().map_err(|e| {
        CommandError::new(
            ErrorCode::SpawnFailed,
            format!("failed to spawn {program:?}: {e}"),
        )
    })?;

    let pid = child.id();
    let job_id = next_job_id();

    // Take the pipes for the streaming threads.
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let emitter = Arc::new(emitter);

    // Stream stdout line-by-line.
    if let Some(out) = stdout {
        let emitter = Arc::clone(&emitter);
        let job_id = job_id.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(out);
            for line in reader.lines().map_while(Result::ok) {
                emitter.emit_stdout(&job_id, &line);
            }
        });
    }

    // Stream stderr line-by-line.
    if let Some(err) = stderr {
        let emitter = Arc::clone(&emitter);
        let job_id = job_id.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines().map_while(Result::ok) {
                emitter.emit_stderr(&job_id, &line);
            }
        });
    }

    // Register the live job (pid only). The reaper thread owns the `Child`.
    registry.insert(job_id.clone(), JobHandle { pid, cancel: None });

    // Reaper thread: own the child, block on `wait()`, then drop the registry
    // entry and emit `job://exit`. A cancel/kill_all signals the group, which
    // unblocks this `wait()`; whether the job exits on its own or is killed, the
    // entry is removed here exactly once.
    {
        let registry = registry.clone();
        let emitter = Arc::clone(&emitter);
        let job_id = job_id.clone();
        std::thread::spawn(move || {
            let mut child = child;
            let status = child.wait().ok();
            let code = status.and_then(|s| s.code());
            // Remove only if still present (cancel may have already removed it).
            registry.remove(&job_id);
            emitter.emit_exit(&job_id, code);
        });
    }

    Ok(job_id)
}

/// Spawn ONE background job that runs `urls` SEQUENTIALLY (P-eval-all).
///
/// For each url, the runner spawns `program` with `per_url_args(url)` (argv-only,
/// no shell) in `cwd` under the hydrated environment, in its own process group,
/// streaming the child's stdout/stderr as `job://stdout` / `job://stderr` events
/// prefixed by a `=== [i/N] <url> ===` marker (a stdout event), waits for that
/// child to exit, then advances to the next url. A single final `job://exit`
/// event is emitted when all urls are done (code 0) or when cancelled (code 0,
/// the loop simply stopped early).
///
/// CANCELLATION: the job is registered upfront with a shared cancel flag.
/// [`JobRegistry::cancel`] flips the flag (stopping the loop before the next
/// url) AND kills the currently-running child's process group. The runner polls
/// the flag between urls.
///
/// Returns the new job id immediately; the loop runs on a background thread.
pub fn spawn_sequential_job_with_emitter<E, F>(
    emitter: E,
    registry: &JobRegistry,
    program: String,
    per_url_args: F,
    urls: Vec<String>,
    cwd: PathBuf,
    leading_line: Option<String>,
) -> String
where
    E: JobEmitter + Send + Sync + 'static,
    F: Fn(&str) -> Vec<String> + Send + 'static,
{
    let job_id = next_job_id();
    let cancel = registry.insert_sequential(job_id.clone());
    let registry = registry.clone();
    let emitter = Arc::new(emitter);

    {
        let job_id = job_id.clone();
        std::thread::spawn(move || {
            if let Some(line) = leading_line {
                emitter.emit_stdout(&job_id, &line);
            }

            let total = urls.len();
            for (i, url) in urls.iter().enumerate() {
                // Stop before spawning the next child if cancelled.
                if cancel.load(Ordering::SeqCst) {
                    break;
                }

                let args = per_url_args(url);
                let mut cmd = Command::new(&program);
                cmd.args(&args)
                    .current_dir(&cwd)
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                env::hydrated_env().apply_to_command(&mut cmd);

                #[cfg(unix)]
                {
                    unsafe {
                        cmd.pre_exec(|| {
                            if libc::setpgid(0, 0) != 0 {
                                return Err(std::io::Error::last_os_error());
                            }
                            Ok(())
                        });
                    }
                }

                let mut child = match cmd.spawn() {
                    Ok(c) => c,
                    Err(e) => {
                        emitter.emit_stdout(&job_id, &format!("=== [{}/{}] {} ===", i + 1, total, url));
                        emitter.emit_stderr(&job_id, &format!("failed to spawn {program:?}: {e}"));
                        continue;
                    }
                };

                let pid = child.id();
                // Publish the live pid BEFORE emitting the marker, so that once a
                // caller observes the marker the pid is already registered and a
                // concurrent cancel is guaranteed to hit THIS child's group (not
                // race ahead of it). If cancel already fired, kill immediately.
                registry.set_pid(&job_id, pid);
                emitter.emit_stdout(&job_id, &format!("=== [{}/{}] {} ===", i + 1, total, url));
                if cancel.load(Ordering::SeqCst) {
                    kill_group(pid);
                }

                // Stream this child's stdout/stderr on background threads.
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                let mut handles = Vec::new();
                if let Some(out) = stdout {
                    let emitter = Arc::clone(&emitter);
                    let job_id = job_id.clone();
                    handles.push(std::thread::spawn(move || {
                        let reader = BufReader::new(out);
                        for line in reader.lines().map_while(Result::ok) {
                            emitter.emit_stdout(&job_id, &line);
                        }
                    }));
                }
                if let Some(err) = stderr {
                    let emitter = Arc::clone(&emitter);
                    let job_id = job_id.clone();
                    handles.push(std::thread::spawn(move || {
                        let reader = BufReader::new(err);
                        for line in reader.lines().map_while(Result::ok) {
                            emitter.emit_stderr(&job_id, &line);
                        }
                    }));
                }

                // Wait for this child to exit (a cancel kills its group, which
                // unblocks this wait), then drain the streaming threads.
                let _ = child.wait();
                for h in handles {
                    let _ = h.join();
                }
            }

            // Done (all urls processed, or cancelled). Drop the registry entry
            // (cancel may already have removed it) and emit the single exit.
            registry.remove(&job_id);
            emitter.emit_exit(&job_id, Some(0));
        });
    }

    job_id
}

/// Production wrapper over [`spawn_sequential_job_with_emitter`] using a Tauri
/// `AppHandle` as the event emitter.
#[allow(clippy::too_many_arguments)]
pub fn spawn_sequential_job<F>(
    app: &tauri::AppHandle,
    registry: &JobRegistry,
    program: String,
    per_url_args: F,
    urls: Vec<String>,
    cwd: PathBuf,
    leading_line: Option<String>,
) -> String
where
    F: Fn(&str) -> Vec<String> + Send + 'static,
{
    spawn_sequential_job_with_emitter(
        AppHandleEmitter::new(app.clone()),
        registry,
        program,
        per_url_args,
        urls,
        cwd,
        leading_line,
    )
}

/// Trait abstracting "emit a Tauri event" so the spawner is testable.
///
/// Production uses the [`AppHandleEmitter`] (a thin wrapper over a Tauri
/// `AppHandle`); tests use a channel-backed collector.
pub trait JobEmitter {
    fn emit_stdout(&self, job_id: &str, line: &str);
    fn emit_stderr(&self, job_id: &str, line: &str);
    fn emit_exit(&self, job_id: &str, code: Option<i32>);
}

/// Production emitter: forwards to a Tauri `AppHandle` as `job://*` events.
pub struct AppHandleEmitter {
    app: tauri::AppHandle,
}

impl AppHandleEmitter {
    pub fn new(app: tauri::AppHandle) -> Self {
        AppHandleEmitter { app }
    }
}

impl JobEmitter for AppHandleEmitter {
    fn emit_stdout(&self, job_id: &str, line: &str) {
        use tauri::Emitter;
        let _ = self.app.emit(
            "job://stdout",
            LinePayload {
                job_id: job_id.to_string(),
                line: line.to_string(),
            },
        );
    }

    fn emit_stderr(&self, job_id: &str, line: &str) {
        use tauri::Emitter;
        let _ = self.app.emit(
            "job://stderr",
            LinePayload {
                job_id: job_id.to_string(),
                line: line.to_string(),
            },
        );
    }

    fn emit_exit(&self, job_id: &str, code: Option<i32>) {
        use tauri::Emitter;
        let _ = self.app.emit(
            "job://exit",
            ExitPayload {
                job_id: job_id.to_string(),
                code,
            },
        );
    }
}

/// Spawn a job using a Tauri `AppHandle` as the event emitter (production path).
///
/// Thin wrapper over [`spawn_job_with_emitter`] that constructs an
/// [`AppHandleEmitter`] from the handle. This is the signature Lane-A handlers
/// call.
pub fn spawn_job(
    app: &tauri::AppHandle,
    registry: &JobRegistry,
    program: &str,
    args: &[String],
    cwd: &Path,
) -> Result<String, CommandError> {
    spawn_job_with_emitter(
        AppHandleEmitter::new(app.clone()),
        registry,
        program,
        args,
        cwd,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    /// An event captured by the test emitter.
    #[derive(Debug, Clone, PartialEq)]
    enum Event {
        Stdout { job_id: String, line: String },
        Stderr { job_id: String, line: String },
        Exit { job_id: String, code: Option<i32> },
    }

    /// Channel-backed emitter for tests.
    struct ChannelEmitter {
        tx: mpsc::Sender<Event>,
    }

    impl JobEmitter for ChannelEmitter {
        fn emit_stdout(&self, job_id: &str, line: &str) {
            let _ = self.tx.send(Event::Stdout {
                job_id: job_id.to_string(),
                line: line.to_string(),
            });
        }
        fn emit_stderr(&self, job_id: &str, line: &str) {
            let _ = self.tx.send(Event::Stderr {
                job_id: job_id.to_string(),
                line: line.to_string(),
            });
        }
        fn emit_exit(&self, job_id: &str, code: Option<i32>) {
            let _ = self.tx.send(Event::Exit {
                job_id: job_id.to_string(),
                code,
            });
        }
    }

    #[test]
    fn echo_streams_stdout_then_exits_zero() {
        let (tx, rx) = mpsc::channel();
        let registry = JobRegistry::new();
        let job_id = spawn_job_with_emitter(
            ChannelEmitter { tx },
            &registry,
            "echo",
            &["hello".to_string()],
            Path::new("/"),
        )
        .expect("spawn echo");

        // Collect ALL events until the channel disconnects (every emitter clone
        // dropped). Don't stop on `Exit`: the reaper thread and the stdout
        // streamer race, so the exit event can arrive before the stdout line.
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut saw_stdout = false;
        let mut exit_code: Option<Option<i32>> = None;
        loop {
            if Instant::now() >= deadline {
                break;
            }
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Event::Stdout { job_id: jid, line }) => {
                    assert_eq!(jid, job_id);
                    if line == "hello" {
                        saw_stdout = true;
                    }
                }
                Ok(Event::Exit { job_id: jid, code }) => {
                    assert_eq!(jid, job_id);
                    exit_code = Some(code);
                }
                Ok(_) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        assert!(saw_stdout, "expected a 'hello' stdout line");
        assert_eq!(exit_code, Some(Some(0)), "expected exit code 0");
        // The job is dropped from the registry once it exits.
        assert!(!registry.contains(&job_id), "registry must drop finished job");
    }

    #[test]
    fn cancel_terminates_sleep_quickly_no_orphan() {
        let (tx, _rx) = mpsc::channel();
        let registry = JobRegistry::new();
        let job_id = spawn_job_with_emitter(
            ChannelEmitter { tx },
            &registry,
            "sleep",
            &["30".to_string()],
            Path::new("/"),
        )
        .expect("spawn sleep");

        // It's registered and live.
        assert!(registry.contains(&job_id), "job should be live after spawn");

        let start = Instant::now();
        registry.cancel(&job_id).expect("cancel ok");
        let elapsed = start.elapsed();

        assert!(
            elapsed < Duration::from_secs(1),
            "cancel should return within ~1s, took {elapsed:?}"
        );
        // Cancel removes it from the registry → no orphan tracked.
        assert!(
            !registry.contains(&job_id),
            "cancelled job must be removed from registry"
        );
        assert_eq!(registry.len(), 0, "no jobs should remain");
    }

    #[test]
    fn two_concurrent_jobs_get_distinct_ids() {
        let (tx, _rx) = mpsc::channel();
        let registry = JobRegistry::new();
        let a = spawn_job_with_emitter(
            ChannelEmitter { tx: tx.clone() },
            &registry,
            "sleep",
            &["5".to_string()],
            Path::new("/"),
        )
        .expect("spawn a");
        let b = spawn_job_with_emitter(
            ChannelEmitter { tx },
            &registry,
            "sleep",
            &["5".to_string()],
            Path::new("/"),
        )
        .expect("spawn b");

        assert_ne!(a, b, "concurrent jobs must have distinct ids");
        assert_eq!(registry.len(), 2, "both jobs tracked");

        // Clean up so the test leaves no orphans.
        registry.kill_all();
        assert_eq!(registry.len(), 0, "kill_all drains the registry");
    }

    #[test]
    fn sequential_job_runs_each_url_with_markers_then_one_exit() {
        let (tx, rx) = mpsc::channel();
        let registry = JobRegistry::new();
        let urls = vec!["one".to_string(), "two".to_string()];

        let job_id = spawn_sequential_job_with_emitter(
            ChannelEmitter { tx },
            &registry,
            "echo".to_string(),
            |url| vec![url.to_string()],
            urls,
            PathBuf::from("/"),
            Some("Evaluating 2 pending URLs with model claude-sonnet-4-6…".to_string()),
        );

        // Collect until disconnect (all emitter clones dropped).
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut stdout_lines = Vec::new();
        let mut exits = 0;
        loop {
            if Instant::now() >= deadline {
                break;
            }
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Event::Stdout { job_id: jid, line }) => {
                    assert_eq!(jid, job_id);
                    stdout_lines.push(line);
                }
                Ok(Event::Exit { job_id: jid, code }) => {
                    assert_eq!(jid, job_id);
                    assert_eq!(code, Some(0));
                    exits += 1;
                }
                Ok(_) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        assert_eq!(exits, 1, "exactly one final exit event for the batch");
        // Leading line emitted first.
        assert!(
            stdout_lines.iter().any(|l| l.starts_with("Evaluating 2 pending URLs")),
            "leading line missing: {stdout_lines:?}"
        );
        // A marker per url, in order.
        assert!(stdout_lines.iter().any(|l| l == "=== [1/2] one ==="), "{stdout_lines:?}");
        assert!(stdout_lines.iter().any(|l| l == "=== [2/2] two ==="), "{stdout_lines:?}");
        // Each child's stdout (the echoed url) is streamed.
        assert!(stdout_lines.iter().any(|l| l == "one"));
        assert!(stdout_lines.iter().any(|l| l == "two"));
        // Marker [1/2] precedes marker [2/2] (sequential order).
        let i1 = stdout_lines.iter().position(|l| l == "=== [1/2] one ===").unwrap();
        let i2 = stdout_lines.iter().position(|l| l == "=== [2/2] two ===").unwrap();
        assert!(i1 < i2, "urls must run sequentially in order");
        // Registry drained when finished.
        assert!(!registry.contains(&job_id));
    }

    #[test]
    fn sequential_job_cancel_stops_loop_and_kills_child() {
        let (tx, rx) = mpsc::channel();
        let registry = JobRegistry::new();
        // Three long sleeps; we cancel during the first so the 2nd/3rd never run.
        let urls = vec!["30".to_string(), "30".to_string(), "30".to_string()];

        let job_id = spawn_sequential_job_with_emitter(
            ChannelEmitter { tx },
            &registry,
            "sleep".to_string(),
            |secs| vec![secs.to_string()],
            urls,
            PathBuf::from("/"),
            None,
        );

        // Wait until the first child has spawned (its marker appears + pid set).
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut markers = Vec::new();
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Event::Stdout { line, .. }) => {
                    if line.starts_with("=== [") {
                        markers.push(line);
                        break;
                    }
                }
                Ok(_) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        assert!(registry.contains(&job_id), "job should be live mid-run");

        let start = Instant::now();
        registry.cancel(&job_id).expect("cancel ok");
        assert!(
            start.elapsed() < Duration::from_secs(1),
            "cancel returns promptly"
        );

        // Drain remaining events; we must see exactly one exit and only the FIRST
        // url's marker (the loop stopped before urls 2 and 3).
        let mut exits = 0;
        let drain_deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if Instant::now() >= drain_deadline {
                break;
            }
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Event::Stdout { line, .. }) => {
                    if line.starts_with("=== [") {
                        markers.push(line);
                    }
                }
                Ok(Event::Exit { code, .. }) => {
                    assert_eq!(code, Some(0));
                    exits += 1;
                }
                Ok(_) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        assert_eq!(exits, 1, "one final exit even when cancelled");
        // Only the first url ever started; the 2nd/3rd markers must be absent.
        assert!(markers.iter().any(|m| m.contains("[1/3]")), "{markers:?}");
        assert!(!markers.iter().any(|m| m.contains("[2/3]")), "loop must stop: {markers:?}");
        assert!(!markers.iter().any(|m| m.contains("[3/3]")), "loop must stop: {markers:?}");
        assert!(!registry.contains(&job_id), "cancelled job removed");
    }

    #[test]
    fn kill_all_terminates_every_job() {
        let (tx, _rx) = mpsc::channel();
        let registry = JobRegistry::new();
        for _ in 0..3 {
            spawn_job_with_emitter(
                ChannelEmitter { tx: tx.clone() },
                &registry,
                "sleep",
                &["30".to_string()],
                Path::new("/"),
            )
            .expect("spawn");
        }
        assert_eq!(registry.len(), 3);
        registry.kill_all();
        assert_eq!(registry.len(), 0, "kill_all leaves no jobs");
    }
}
