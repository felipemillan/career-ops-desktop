//! Login-shell environment hydration (P3-T1).
//!
//! The load-bearing gate for Lanes B/C: when career-ops-desktop is launched as a
//! bundled `.app`, the process inherits a minimal environment (notably a
//! truncated `PATH`) that does **not** include the user's login-shell additions.
//! The real `claude` binary lives at `~/.local/bin/claude` on this machine,
//! which is on the login-shell `PATH` but not on the default GUI `PATH`. Every
//! child we spawn (headless `claude -p`, the PTY shell, sidecars) must therefore
//! run with the *login-shell* environment, not the inherited one.
//!
//! Strategy:
//! 1. Once per process, spawn `<$SHELL> -lic 'env'` (a login + interactive shell
//!    so `.zprofile`/`.zshrc` etc. run), fenced by a sentinel so we parse only
//!    the `env` block and ignore any banner/MOTD noise. 30s timeout.
//! 2. Parse `KEY=VALUE` lines, capturing `PATH` and any `ANTHROPIC_*` /
//!    `CLAUDE_*` / `FIRECRAWL_*` variables (plus everything else, so child
//!    spawns get a faithful environment).
//! 3. Resolve binaries by walking the hydrated `PATH` (no hardcoded allowlist).
//! 4. Cache the result in a [`OnceLock`] so the shell runs at most once.
//!
//! If `claude` cannot be resolved, callers get a typed error mapping to
//! [`ErrorCode::AuthMissing`].

use crate::commands::{CommandError, ErrorCode};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::sync::mpsc;
use std::time::Duration;

/// Sentinel fence printed immediately before and after `env` in the shell
/// invocation. Parsing only trusts lines strictly between the two markers, so
/// shell startup banners / MOTDs printed before `env` are ignored. The value is
/// deliberately unlikely to appear in any real env var.
const SENTINEL: &str = "__CAREER_OPS_ENV_SENTINEL_3f9a1c__";

/// Maximum time to wait for the login shell to print its environment.
const SHELL_TIMEOUT: Duration = Duration::from_secs(30);

/// Fallback shells tried (in order) when `$SHELL` is unset.
const FALLBACK_SHELLS: [&str; 2] = ["/bin/zsh", "/bin/bash"];

/// The hydrated login-shell environment.
///
/// Holds the parsed `KEY=VALUE` map plus a convenience copy of `PATH`. Cloneable
/// so callers can take an owned snapshot; the canonical instance is cached in a
/// process-wide [`OnceLock`].
#[derive(Debug, Clone, Default)]
pub struct HydratedEnv {
    /// All parsed environment variables from the login shell.
    pub vars: BTreeMap<String, String>,
}

impl HydratedEnv {
    /// The hydrated `PATH`, or an empty string if the shell did not export one.
    pub fn path(&self) -> &str {
        self.vars.get("PATH").map(String::as_str).unwrap_or("")
    }

    /// Apply this environment to a [`std::process::Command`] for a child spawn.
    ///
    /// Clears the child's inherited environment and replaces it with the
    /// hydrated one, so the child runs with exactly the login-shell environment
    /// regardless of how the GUI process was launched.
    pub fn apply_to_command(&self, cmd: &mut Command) {
        cmd.env_clear();
        for (k, v) in &self.vars {
            cmd.env(k, v);
        }
    }

    /// Resolve an executable by name against this environment's `PATH`.
    ///
    /// Convenience wrapper over [`resolve_binary`] using `self.path()`.
    pub fn resolve(&self, name: &str) -> Option<PathBuf> {
        resolve_binary(name, self.path())
    }
}

/// Process-wide cache of the hydrated environment. Populated at most once.
static HYDRATED: OnceLock<HydratedEnv> = OnceLock::new();

/// Return the cached login-shell environment, hydrating it on first call.
///
/// The shell is spawned at most once per process; subsequent calls return the
/// cached value. Hydration failures (shell missing, timeout, parse error)
/// degrade to an empty environment rather than panicking — callers that need a
/// specific binary (e.g. `claude`) get a typed [`ErrorCode::AuthMissing`] error
/// via [`require_binary`].
pub fn hydrated_env() -> &'static HydratedEnv {
    HYDRATED.get_or_init(|| hydrate().unwrap_or_default())
}

/// Run the login shell once and parse its environment.
///
/// Returns `Err` only for the spawn/timeout/IO failure path; a successful run
/// with an empty sentinel block yields an empty (but `Ok`) map.
pub fn hydrate() -> Result<HydratedEnv, CommandError> {
    let shell = pick_shell();
    let raw = run_login_shell_env(&shell)?;
    let vars = parse_sentinel_env(&raw);
    Ok(HydratedEnv { vars })
}

/// Pick the shell to use: `$SHELL` if set, else the first existing fallback,
/// else the first fallback unconditionally (the spawn will then error cleanly).
fn pick_shell() -> String {
    if let Ok(s) = std::env::var("SHELL") {
        if !s.trim().is_empty() {
            return s;
        }
    }
    for candidate in FALLBACK_SHELLS {
        if Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    FALLBACK_SHELLS[0].to_string()
}

/// Spawn `<shell> -lic '<sentinel> ; env ; <sentinel>'` and capture stdout with
/// a 30s timeout. The `-lic` flags make it a login + interactive shell running a
/// command, so the user's profile files are sourced.
fn run_login_shell_env(shell: &str) -> Result<String, CommandError> {
    // Print the sentinel, then env, then the sentinel again. Parsing trusts only
    // the block strictly between the two markers.
    let script = format!("printf '%s\\n' '{SENTINEL}'; env; printf '%s\\n' '{SENTINEL}'");

    let mut child = Command::new(shell)
        .args(["-lic", &script])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| {
            CommandError::new(
                ErrorCode::SpawnFailed,
                format!("failed to spawn login shell {shell:?}: {e}"),
            )
        })?;

    // Wait on a background thread so we can enforce the timeout. We must take
    // stdout before waiting to avoid a pipe-buffer deadlock; read it on the same
    // worker thread.
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| CommandError::new(ErrorCode::SpawnFailed, "login shell stdout unavailable"))?;

    let (tx, rx) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = String::new();
        let read_res = stdout.read_to_string(&mut buf);
        // child.wait() reaps the process; ignore its status — we only need env.
        let wait_res = child.wait();
        let _ = tx.send((read_res.map(|_| buf), wait_res));
    });

    match rx.recv_timeout(SHELL_TIMEOUT) {
        Ok((Ok(buf), _)) => {
            let _ = handle.join();
            Ok(buf)
        }
        Ok((Err(e), _)) => {
            let _ = handle.join();
            Err(CommandError::new(
                ErrorCode::SpawnFailed,
                format!("failed to read login shell output: {e}"),
            ))
        }
        Err(mpsc::RecvTimeoutError::Timeout) => Err(CommandError::new(
            ErrorCode::SpawnFailed,
            format!(
                "login shell {shell:?} timed out after {}s",
                SHELL_TIMEOUT.as_secs()
            ),
        )),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(CommandError::new(
            ErrorCode::SpawnFailed,
            "login shell worker disconnected",
        )),
    }
}

/// Parse `KEY=VALUE` lines from the output, trusting only the block between the
/// two sentinel markers.
///
/// A var's value may legitimately contain `=` (only the first `=` splits the
/// pair) and may span multiple lines (e.g. a multi-line export); continuation
/// lines with no `=` are appended to the previous variable's value.
fn parse_sentinel_env(raw: &str) -> BTreeMap<String, String> {
    let mut vars = BTreeMap::new();

    // Locate the block strictly between the first and second sentinel lines.
    let mut lines = raw.lines();
    // Advance to the opening sentinel.
    let mut started = false;
    for line in lines.by_ref() {
        if line.trim() == SENTINEL {
            started = true;
            break;
        }
    }
    if !started {
        // No sentinel found — fall back to parsing the whole output so a shell
        // that swallowed our printf still yields something usable.
        return parse_kv_block(raw.lines());
    }

    // Collect until the closing sentinel.
    let mut block: Vec<&str> = Vec::new();
    for line in lines {
        if line.trim() == SENTINEL {
            break;
        }
        block.push(line);
    }

    vars.extend(parse_kv_block(block.into_iter()));
    vars
}

/// Parse an iterator of lines as `KEY=VALUE` env entries.
fn parse_kv_block<'a, I: Iterator<Item = &'a str>>(lines: I) -> BTreeMap<String, String> {
    let mut vars: BTreeMap<String, String> = BTreeMap::new();
    let mut last_key: Option<String> = None;

    for line in lines {
        if let Some((key, value)) = line.split_once('=') {
            // A valid env key is non-empty and contains no whitespace. If it
            // looks like a key, start a new var; otherwise treat as a
            // continuation of the previous value.
            if is_env_key(key) {
                vars.insert(key.to_string(), value.to_string());
                last_key = Some(key.to_string());
                continue;
            }
        }
        // Continuation line (multi-line value): append to the previous var.
        if let Some(k) = &last_key {
            if let Some(v) = vars.get_mut(k) {
                v.push('\n');
                v.push_str(line);
            }
        }
    }

    vars
}

/// Whether `s` is a plausible environment-variable name (non-empty, no
/// whitespace, no leading digit, ASCII alnum + underscore).
fn is_env_key(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let mut chars = s.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Resolve an executable by name against a `PATH` string.
///
/// Walks each `:`-separated directory in `path` and returns the first
/// `dir/name` that exists and is executable. This is how we find `claude` at
/// `~/.local/bin/claude` — that directory is on the login-shell `PATH` but not
/// on the GUI-inherited one, and we never hardcode an allowlist of directories.
///
/// Returns `None` if `name` is empty, contains a path separator (callers must
/// pass a bare binary name), or is not found on `path`.
pub fn resolve_binary(name: &str, path: &str) -> Option<PathBuf> {
    if name.is_empty() || name.contains('/') {
        return None;
    }
    for dir in path.split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = Path::new(dir).join(name);
        if is_executable_file(&candidate) {
            return Some(candidate);
        }
    }
    None
}

/// Whether `p` points at a regular file (following symlinks) that has any
/// executable bit set.
fn is_executable_file(p: &Path) -> bool {
    // `metadata` follows symlinks, so `~/.local/bin/claude` (a symlink to the
    // real versioned binary) resolves correctly.
    let Ok(meta) = std::fs::metadata(p) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// User-facing message produced when `claude` cannot be resolved on `PATH`.
pub const CLAUDE_MISSING_MESSAGE: &str =
    "claude CLI not found on PATH — install it or check your shell profile";

/// Resolve a required binary, mapping a miss to [`ErrorCode::AuthMissing`].
///
/// `claude` specifically yields [`CLAUDE_MISSING_MESSAGE`]; other names get a
/// generic "not found" message under the same code.
pub fn require_binary(env: &HydratedEnv, name: &str) -> Result<PathBuf, CommandError> {
    env.resolve(name).ok_or_else(|| {
        let message = if name == "claude" {
            CLAUDE_MISSING_MESSAGE.to_string()
        } else {
            format!("{name} not found on PATH")
        };
        CommandError::new(ErrorCode::AuthMissing, message)
    })
}

/// Resolve the `claude` binary from the cached hydrated env, or
/// [`ErrorCode::AuthMissing`].
pub fn require_claude() -> Result<PathBuf, CommandError> {
    require_binary(hydrated_env(), "claude")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- live hydration (actually runs the login shell in this environment) ----

    #[test]
    fn hydration_returns_non_empty_path() {
        let env = hydrate().expect("login shell hydration should succeed");
        assert!(
            !env.path().is_empty(),
            "hydrated PATH should be non-empty, got vars: {:?}",
            env.vars.keys().collect::<Vec<_>>()
        );
    }

    #[test]
    fn resolve_binary_finds_real_claude_via_hydrated_path() {
        let env = hydrate().expect("hydration should succeed");
        let resolved = resolve_binary("claude", env.path());
        assert!(
            resolved.is_some(),
            "expected to resolve real `claude` via hydrated PATH={:?}",
            env.path()
        );
        // require_binary must agree and return an Ok path.
        let required = require_binary(&env, "claude").expect("claude should be required-resolvable");
        assert!(required.exists(), "resolved claude path should exist: {required:?}");
    }

    #[test]
    fn resolve_binary_returns_none_for_nonsense() {
        let env = hydrate().expect("hydration should succeed");
        assert!(resolve_binary("definitely-not-a-real-binary-xyz123", env.path()).is_none());
    }

    #[test]
    fn missing_claude_produces_auth_missing_message() {
        // Simulate claude being absent by resolving against an empty PATH.
        let env = HydratedEnv {
            vars: [("PATH".to_string(), String::new())].into_iter().collect(),
        };
        let err = require_binary(&env, "claude").unwrap_err();
        assert_eq!(err.code, ErrorCode::AuthMissing);
        assert_eq!(err.message, CLAUDE_MISSING_MESSAGE);
    }

    // ---- pure parsing units ----

    #[test]
    fn parse_sentinel_extracts_only_fenced_block() {
        let raw = format!(
            "MOTD: welcome\nNOISE=ignored_before\n{SENTINEL}\nPATH=/usr/bin:/bin\nFOO=bar\n{SENTINEL}\nNOISE=ignored_after\n"
        );
        let vars = parse_sentinel_env(&raw);
        assert_eq!(vars.get("PATH").map(String::as_str), Some("/usr/bin:/bin"));
        assert_eq!(vars.get("FOO").map(String::as_str), Some("bar"));
        // Lines outside the fence are not captured.
        assert!(!vars.contains_key("NOISE"));
    }

    #[test]
    fn parse_captures_anthropic_claude_firecrawl_vars() {
        let raw = format!(
            "{SENTINEL}\nPATH=/x\nANTHROPIC_API_KEY=sk-ant-123\nCLAUDE_CONFIG_DIR=/home/u/.claude\nFIRECRAWL_API_KEY=fc-456\n{SENTINEL}\n"
        );
        let vars = parse_sentinel_env(&raw);
        assert_eq!(vars.get("ANTHROPIC_API_KEY").map(String::as_str), Some("sk-ant-123"));
        assert_eq!(vars.get("CLAUDE_CONFIG_DIR").map(String::as_str), Some("/home/u/.claude"));
        assert_eq!(vars.get("FIRECRAWL_API_KEY").map(String::as_str), Some("fc-456"));
    }

    #[test]
    fn parse_handles_values_with_equals_and_continuations() {
        let raw = format!(
            "{SENTINEL}\nKEYVAL=a=b=c\nMULTI=line1\ncontinued\nNEXT=ok\n{SENTINEL}\n"
        );
        let vars = parse_sentinel_env(&raw);
        // Only the first '=' splits.
        assert_eq!(vars.get("KEYVAL").map(String::as_str), Some("a=b=c"));
        // Continuation line (no '=') appends to previous value.
        assert_eq!(vars.get("MULTI").map(String::as_str), Some("line1\ncontinued"));
        assert_eq!(vars.get("NEXT").map(String::as_str), Some("ok"));
    }

    #[test]
    fn resolve_binary_rejects_pathy_names() {
        assert!(resolve_binary("", "/usr/bin").is_none());
        assert!(resolve_binary("../claude", "/usr/bin").is_none());
        assert!(resolve_binary("a/b", "/usr/bin").is_none());
    }

    #[test]
    fn apply_to_command_replaces_environment() {
        let env = HydratedEnv {
            vars: [
                ("PATH".to_string(), "/custom/bin".to_string()),
                ("MY_VAR".to_string(), "hello".to_string()),
            ]
            .into_iter()
            .collect(),
        };
        let mut cmd = Command::new("/bin/sh");
        env.apply_to_command(&mut cmd);
        // get_envs yields (key, Some(value)) entries after env_clear + sets.
        let collected: BTreeMap<String, String> = cmd
            .get_envs()
            .filter_map(|(k, v)| {
                Some((k.to_str()?.to_string(), v?.to_str()?.to_string()))
            })
            .collect();
        assert_eq!(collected.get("PATH").map(String::as_str), Some("/custom/bin"));
        assert_eq!(collected.get("MY_VAR").map(String::as_str), Some("hello"));
    }
}
