//! Embedded-terminal PTY engine (P4-T1).
//!
//! Backs the Terminal tab: a real pseudo-terminal hosting the user's interactive
//! shell (so `claude` / `/career-ops` run inside the `.app` exactly as they would
//! in Terminal.app). Bytes flow over a **dedicated event channel** (`pty://data`
//! / `pty://exit`), NOT through the typed `dispatch` command surface — terminal
//! traffic is raw, high-frequency, and binary, so it gets its own lane.
//!
//! Design:
//! 1. [`pty_open`] opens a PTY via `portable-pty`, spawns the user's `$SHELL`
//!    (fallback `/bin/zsh`) under the **canonical hydrated login-shell
//!    environment** ([`env::hydrated_env`]) so `claude`/`node` are on `PATH`
//!    inside a bundled `.app`. It returns a `pty_id`.
//! 2. A reader thread drains the PTY master, **base64-encodes** each chunk of
//!    bytes (raw terminal output is not valid UTF-8 — control sequences, partial
//!    multibyte runs), and emits `pty://data` `{ ptyId, data }`. On EOF / child
//!    exit it emits `pty://exit` `{ ptyId, code }`.
//! 3. [`pty_write`] base64-decodes frontend input and writes the bytes to the
//!    PTY. [`pty_resize`] forwards a window resize (SIGWINCH). [`pty_kill`]
//!    terminates the child.
//! 4. A [`PtyRegistry`] (Tauri state) tracks every live PTY so the app-exit hook
//!    can [`PtyRegistry::kill_all`] them — no terminal child outlives the GUI.
//!
//! These four commands are registered **directly** in the `invoke_handler`
//! (`pty_open`/`pty_write`/`pty_resize`/`pty_kill`), not routed through
//! `dispatch`.

use crate::env;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Monotonic pty-id source. Ids are `"pty-{n}"`, unique per process.
static PTY_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Read-chunk size for the PTY reader thread.
const READ_CHUNK: usize = 8 * 1024;

/// Default shell used when `$SHELL` is absent from the hydrated environment.
const FALLBACK_SHELL: &str = "/bin/zsh";

/// A live PTY tracked in the registry.
///
/// Holds the master end (for resize + a cloned writer) and a child killer so the
/// terminal can be torn down on demand or on app exit. The reader/wait threads
/// own their own clones of the reader and killer respectively.
struct PtyHandle {
    /// Master end of the pty — used for `resize`.
    master: Box<dyn MasterPty + Send>,
    /// A writer onto the pty (frontend keystrokes are written here).
    writer: Box<dyn Write + Send>,
    /// A killer for the spawned child (terminate on `pty_kill` / `kill_all`).
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// Process-wide registry of live PTYs, held in Tauri managed state.
///
/// Wraps a `Mutex<HashMap<PtyId, PtyHandle>>`. Entries are inserted on
/// [`pty_open`] and removed on [`pty_kill`], child exit, or [`kill_all`].
#[derive(Clone, Default)]
pub struct PtyRegistry {
    inner: Arc<Mutex<HashMap<String, PtyHandle>>>,
}

impl PtyRegistry {
    pub fn new() -> Self {
        PtyRegistry {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Number of live PTYs (test/introspection helper).
    pub fn len(&self) -> usize {
        self.inner.lock().expect("pty registry lock").len()
    }

    /// Whether a pty id is currently live.
    pub fn contains(&self, pty_id: &str) -> bool {
        self.inner
            .lock()
            .expect("pty registry lock")
            .contains_key(pty_id)
    }

    fn insert(&self, pty_id: String, handle: PtyHandle) {
        self.inner
            .lock()
            .expect("pty registry lock")
            .insert(pty_id, handle);
    }

    fn remove(&self, pty_id: &str) -> Option<PtyHandle> {
        self.inner.lock().expect("pty registry lock").remove(pty_id)
    }

    /// Kill a single PTY's child and drop it. No-op (Ok) if already gone.
    pub fn kill(&self, pty_id: &str) {
        if let Some(mut handle) = self.remove(pty_id) {
            let _ = handle.killer.kill();
        }
    }

    /// Kill ALL live PTYs. Called from the app-exit hook so no terminal child
    /// outlives the GUI. Drains under the lock, then kills each child.
    pub fn kill_all(&self) {
        let drained: Vec<(String, PtyHandle)> = {
            let mut guard = self.inner.lock().expect("pty registry lock");
            guard.drain().collect()
        };
        for (_id, mut handle) in drained {
            let _ = handle.killer.kill();
        }
    }
}

/// Allocate the next unique pty id (`"pty-{n}"`).
fn next_pty_id() -> String {
    let n = PTY_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("pty-{n}")
}

/// Event payload for a chunk of terminal output. `data` is **base64**.
#[derive(Debug, Clone, Serialize)]
struct DataPayload {
    #[serde(rename = "ptyId")]
    pty_id: String,
    /// Base64-encoded raw PTY output bytes.
    data: String,
}

/// Event payload for terminal teardown.
#[derive(Debug, Clone, Serialize)]
struct ExitPayload {
    #[serde(rename = "ptyId")]
    pty_id: String,
    /// The child's exit code (best-effort; PTY exit codes are u32 on this crate).
    code: Option<i32>,
}

/// Encode raw bytes to a base64 frame string (transport-safe over a JSON event).
fn encode_frame(bytes: &[u8]) -> String {
    B64.encode(bytes)
}

/// Decode a base64 frame string back to raw bytes. Errors map to a `String`.
fn decode_frame(data: &str) -> Result<Vec<u8>, String> {
    B64.decode(data.as_bytes())
        .map_err(|e| format!("invalid base64 pty frame: {e}"))
}

/// Pick the interactive shell to spawn inside the PTY: the hydrated `$SHELL`,
/// else [`FALLBACK_SHELL`].
fn pick_shell() -> String {
    let env = env::hydrated_env();
    match env.vars.get("SHELL") {
        Some(s) if !s.trim().is_empty() => s.clone(),
        _ => FALLBACK_SHELL.to_string(),
    }
}

/// Open a PTY, spawn the user's login shell under the hydrated environment, and
/// stream its output as `pty://data` events. Returns a `pty_id`.
#[tauri::command]
pub fn pty_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, PtyRegistry>,
    config_base: tauri::State<'_, crate::commands::ConfigBase>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("failed to open pty: {e}"))?;

    // Build the shell command with the FULL hydrated login-shell environment so
    // `claude`/`node` are on PATH inside a bundled `.app`. `-l` makes it a login
    // shell so the user's normal prompt/profile is in effect.
    let shell = pick_shell();
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    let hydrated = env::hydrated_env();
    cmd.env_clear();
    for (k, v) in &hydrated.vars {
        cmd.env(k, v);
    }
    // TERM drives terminal capabilities; default to a sane xterm profile if the
    // login env didn't export one (GUI launch often omits it).
    if !hydrated.vars.contains_key("TERM") {
        cmd.env("TERM", "xterm-256color");
    }

    // Start the terminal IN the career-ops repo (so scan/merge/claude operate on
    // it). Re-resolve live (env → config.json → default) so a root the user just
    // picked takes effect without a restart; fall back to home if none is valid.
    let env_root = std::env::var("CAREER_OPS_PATH").ok();
    if let Ok(root) =
        crate::paths::resolve_repo_root(env_root.as_deref(), &config_base.0, &config_base.0)
    {
        if crate::paths::is_valid_root(&root) {
            cmd.cwd(&root);
        }
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to spawn shell {shell:?} in pty: {e}"))?;

    // A reader clone for the streaming thread; the master stays in the handle for
    // resize. The writer is cloned out for `pty_write`. The killer is cloned for
    // both the handle (on-demand/exit kill) and the wait thread.
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to clone pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to take pty writer: {e}"))?;
    let killer = child.clone_killer();

    let pty_id = next_pty_id();

    state.insert(
        pty_id.clone(),
        PtyHandle {
            master: pair.master,
            writer,
            killer,
        },
    );

    // Reader thread: drain the PTY, base64-frame each chunk → `pty://data`.
    {
        use tauri::Emitter;
        let app = app.clone();
        let pty_id = pty_id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; READ_CHUNK];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF: child closed the pty.
                    Ok(n) => {
                        let _ = app.emit(
                            "pty://data",
                            DataPayload {
                                pty_id: pty_id.clone(),
                                data: encode_frame(&buf[..n]),
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // Wait thread: block on the child, then emit `pty://exit` and drop the entry.
    {
        use tauri::Emitter;
        let app = app.clone();
        let pty_id = pty_id.clone();
        let registry = (*state).clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|status| status.exit_code() as i32);
            registry.remove(&pty_id);
            let _ = app.emit(
                "pty://exit",
                ExitPayload {
                    pty_id: pty_id.clone(),
                    code,
                },
            );
        });
    }

    Ok(pty_id)
}

/// Write base64-encoded `data` (decoded to raw bytes) to a live PTY.
#[tauri::command]
pub fn pty_write(
    state: tauri::State<'_, PtyRegistry>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = decode_frame(&data)?;
    let mut guard = state.inner.lock().expect("pty registry lock");
    let handle = guard
        .get_mut(&pty_id)
        .ok_or_else(|| format!("unknown pty: {pty_id}"))?;
    handle
        .writer
        .write_all(&bytes)
        .map_err(|e| format!("pty write failed: {e}"))?;
    handle
        .writer
        .flush()
        .map_err(|e| format!("pty flush failed: {e}"))?;
    Ok(())
}

/// Resize a live PTY (forwards SIGWINCH to the child).
#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, PtyRegistry>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let guard = state.inner.lock().expect("pty registry lock");
    let handle = guard
        .get(&pty_id)
        .ok_or_else(|| format!("unknown pty: {pty_id}"))?;
    handle
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("pty resize failed: {e}"))?;
    Ok(())
}

/// Kill a live PTY's child process and drop it from the registry.
#[tauri::command]
pub fn pty_kill(state: tauri::State<'_, PtyRegistry>, pty_id: String) -> Result<(), String> {
    state.kill(&pty_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Base64 frame round-trips arbitrary bytes, including non-UTF-8 / control
    /// bytes that real terminal output contains (CSI escape sequences, partial
    /// multibyte runs, NULs, high bytes). This is the load-bearing invariant for
    /// the `pty://data` transport — full PTY spawn is a GUI gate (see note).
    #[test]
    fn base64_frame_round_trips_non_utf8_and_control_bytes() {
        let cases: Vec<Vec<u8>> = vec![
            vec![],                                       // empty chunk
            b"hello world\n".to_vec(),                    // plain ascii
            vec![0x1b, b'[', b'3', b'1', b'm'],           // ANSI CSI (red)
            vec![0x00, 0x01, 0x02, 0x07, 0x1b, 0x7f],     // NUL/control bytes
            vec![0xff, 0xfe, 0xfd, 0x80, 0xc3, 0x28],     // invalid UTF-8 bytes
            (0u16..=255).map(|b| b as u8).collect(),      // every byte value
        ];

        for original in cases {
            let frame = encode_frame(&original);
            // The frame must be pure ASCII (transport-safe in a JSON event).
            assert!(
                frame.bytes().all(|b| b.is_ascii()),
                "base64 frame must be ASCII"
            );
            let decoded = decode_frame(&frame).expect("frame must decode");
            assert_eq!(decoded, original, "round-trip must preserve every byte");
        }
    }

    #[test]
    fn decode_rejects_invalid_base64() {
        // `*` is not in the base64 alphabet.
        assert!(decode_frame("not*base64!").is_err());
    }

    #[test]
    fn registry_kill_all_drains_and_is_empty() {
        // Registry-level invariant without spawning a real shell: insert nothing,
        // assert empty + idempotent kill_all (full lifecycle is the GUI gate).
        let reg = PtyRegistry::new();
        assert_eq!(reg.len(), 0);
        assert!(!reg.contains("pty-1"));
        reg.kill_all(); // no-op on empty registry
        reg.kill("pty-doesnotexist"); // unknown id is a no-op
        assert_eq!(reg.len(), 0);
    }

    #[test]
    fn pty_ids_are_monotonic_and_distinct() {
        let a = next_pty_id();
        let b = next_pty_id();
        assert_ne!(a, b, "pty ids must be distinct");
        assert!(a.starts_with("pty-") && b.starts_with("pty-"));
    }
}
