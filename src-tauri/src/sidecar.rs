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
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
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
    pub pid: u32,
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

    /// Cancel a single job: kill its whole process group and drop it from the
    /// registry. A no-op (Ok) if the id is unknown / already gone.
    ///
    /// The child is reaped by its own reaper thread, which unblocks from
    /// `wait()` as soon as the group is signalled — so no zombie is left and the
    /// reaper emits the final `job://exit` event.
    pub fn cancel(&self, job_id: &str) -> Result<(), CommandError> {
        if let Some(handle) = self.remove(job_id) {
            kill_group(handle.pid);
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
            kill_group(handle.pid);
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
    registry.insert(job_id.clone(), JobHandle { pid });

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
