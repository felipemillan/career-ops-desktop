//! The single allowlisted command surface (P1-T4).
//!
//! The frontend never builds a shell string. It sends a typed, internally-tagged
//! [`Command`] enum to the one `#[tauri::command] dispatch` entry point, and Rust
//! owns the mapping from each variant to a fixed action. The full variant set is
//! declared *now* (Phase 1) so the wire shape is frozen even though most handlers
//! land in later phases — unimplemented variants return
//! `CommandError { code: Internal, .. }` with "not implemented in phase 1".
//!
//! `CommandResponse` is an externally-described tagged enum (`tag = "kind"`) and
//! `CommandError { code, message }` carries a closed [`ErrorCode`]. These shapes
//! are the source of truth that the TypeScript IPC layer mirrors (see
//! `serialize_golden` and the committed fixtures under
//! `src/lib/__fixtures__/`).

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::paths::AppPaths;
use crate::writes;

// ---------------------------------------------------------------------------
// Command enum — the full frozen wire shape.
// ---------------------------------------------------------------------------

/// Every command the frontend can dispatch. Internally tagged by `cmd`
/// (snake_case). The full set is frozen in Phase 1; handlers for later-phase
/// variants return `Internal "not implemented in phase 1"`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Command {
    // --- Phase 1: reads + config ---
    /// Read `data/applications.md` (fallback root-level). Returns `Text`.
    ReadApplications,
    /// Return the current `Config` (root + firecrawl status).
    GetConfig,
    /// Persist the chosen repo root to `config.json` (write via `writes.rs`).
    SaveConfig { root: String },
    /// Check whether a glob (scoped to the repo `output/`) matches any file.
    FileExists { glob: String },

    // --- Phase 2: additional reads ---
    /// Read `data/pipeline.md` (fallback root-level). Returns `Text`.
    ReadPipeline,
    /// Read `data/scan-history.tsv`. Returns `Text`.
    ReadScanHistory,
    /// List report files under `reports/`. Returns `Reports`.
    ListReports,
    /// Read one report by id (`{###}-{slug}-{YYYY-MM-DD}`). Returns `Text`.
    ReadReport { id: String },

    // --- Phase 3: Lane A (zero-token Node scripts) ---
    /// Spawn `scan.mjs` (cwd = repo root). Returns `JobStarted`.
    RunScan {
        #[serde(default)]
        dry_run: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        company: Option<String>,
    },
    /// Spawn `merge-tracker.mjs`. Returns `JobStarted`.
    RunMerge,
    /// Spawn `dedup-tracker.mjs`. Returns `JobStarted`.
    RunDedup,
    /// Spawn `analyze-patterns.mjs`. Returns `JobStarted`.
    RunPatterns,
    /// Spawn `followup-cadence.mjs`. Returns `JobStarted`.
    RunFollowup,
    /// Spawn `verify-pipeline.mjs`. Returns `JobStarted`.
    RunVerifyPipeline,
    /// Generate a CV PDF for an application number. Returns `JobStarted`.
    GenPdf { app_number: u32 },
    /// Export a CV as LaTeX for an application number. Returns `JobStarted`.
    GenLatex { app_number: u32 },
    /// Cancel a running job's process group.
    CancelJob { job_id: String },

    // --- Phase 5: Lane B eval + firecrawl + the two writes ---
    /// Headless `claude -p` evaluation of a URL. Returns `JobStarted`.
    EvaluateUrl { url: String },
    /// Add a firecrawl API key (appended to `.env.firecrawl` via `writes.rs`).
    FirecrawlAddKey { key: String },
    /// Remove a firecrawl API key by index.
    FirecrawlRemoveKey { index: u32 },
    /// Report firecrawl pool status. Returns `FirecrawlStatus`.
    FirecrawlStatus,
    /// Enqueue URLs into the firecrawl scrape pool.
    FirecrawlEnqueue { urls: Vec<String> },
    /// Sanctioned write #1: append a URL to `pipeline.md` (atomic, deduped).
    QueueUrl { url: String },
    /// Sanctioned write #2: edit exactly one tracker row's status (+ optional notes).
    UpdateStatus {
        app_number: u32,
        status: CanonicalStatus,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        notes: Option<String>,
    },
}

// ---------------------------------------------------------------------------
// CanonicalStatus — the closed set from templates/states.yml.
// ---------------------------------------------------------------------------

/// The 8 canonical application states (source of truth: `templates/states.yml`).
/// Serialized in PascalCase; `serde` rejects any free-text value, which is what
/// gates `UpdateStatus` against the closed set.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum CanonicalStatus {
    Evaluated,
    Applied,
    Responded,
    Interview,
    Offer,
    Rejected,
    Discarded,
    #[serde(rename = "SKIP")]
    Skip,
}

impl CanonicalStatus {
    /// The exact label written into the tracker `status` cell.
    pub fn label(self) -> &'static str {
        match self {
            CanonicalStatus::Evaluated => "Evaluated",
            CanonicalStatus::Applied => "Applied",
            CanonicalStatus::Responded => "Responded",
            CanonicalStatus::Interview => "Interview",
            CanonicalStatus::Offer => "Offer",
            CanonicalStatus::Rejected => "Rejected",
            CanonicalStatus::Discarded => "Discarded",
            CanonicalStatus::Skip => "SKIP",
        }
    }
}

// ---------------------------------------------------------------------------
// Error type.
// ---------------------------------------------------------------------------

/// Closed set of error codes surfaced to the frontend.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    NotFound,
    InvalidArg,
    RepoNotConfigured,
    SpawnFailed,
    WriteRejected,
    AuthMissing,
    Internal,
}

/// The error shape returned from every command on the `Err` path.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CommandError {
    pub code: ErrorCode,
    pub message: String,
}

impl CommandError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        CommandError {
            code,
            message: message.into(),
        }
    }

    fn not_implemented() -> Self {
        CommandError::new(ErrorCode::Internal, "not implemented in phase 1")
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{:?}] {}", self.code, self.message)
    }
}

impl std::error::Error for CommandError {}

// ---------------------------------------------------------------------------
// Response types.
// ---------------------------------------------------------------------------

/// Firecrawl pool status surfaced in `GetConfig` and `FirecrawlStatus`.
/// Phase 1 only ever reports the dormant (0-key) state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FirecrawlStatusDto {
    /// Number of configured keys.
    pub keys: u32,
    /// Keys currently cooling down after a 429.
    pub cooling_down: u32,
    /// URLs waiting in the queue.
    pub queue_len: u32,
    /// Whether the pool is dormant (no keys → no activity, no error).
    pub dormant: bool,
}

impl FirecrawlStatusDto {
    /// The dormant (0-key) status.
    pub fn dormant() -> Self {
        FirecrawlStatusDto {
            keys: 0,
            cooling_down: 0,
            queue_len: 0,
            dormant: true,
        }
    }
}

/// One report's metadata in a `Reports` listing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReportMeta {
    /// The report id (filename stem), e.g. `468-getyourguide-2026-06-01`.
    pub id: String,
    /// The filename, e.g. `468-getyourguide-2026-06-01.md`.
    pub filename: String,
}

/// Every successful response. Externally tagged by `kind` (snake_case).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CommandResponse {
    /// Verbatim file content (applications, pipeline, scan history, a report).
    Text { content: String },
    /// The resolved config: repo root + firecrawl status.
    Config {
        root: String,
        firecrawl: FirecrawlStatusDto,
    },
    /// A listing of reports.
    Reports { items: Vec<ReportMeta> },
    /// A job was spawned (Lane A / Lane B). Carries the job id.
    JobStarted { job_id: String },
    /// A boolean result (e.g. `FileExists`).
    Bool { value: bool },
    /// Firecrawl pool status.
    FirecrawlStatus { status: FirecrawlStatusDto },
    /// A sanctioned write completed.
    WriteOk {
        #[serde(default)]
        duplicate: bool,
    },
}

// ---------------------------------------------------------------------------
// Handlers (Phase 1 real; others not-implemented).
// ---------------------------------------------------------------------------

/// Pure dispatch usable in unit tests and from the Tauri command.
///
/// * `paths`        — resolved repo root state.
/// * `config_base`  — base dir for `config.json` (the OS config dir).
pub fn handle(
    command: Command,
    app_paths: &AppPaths,
    config_base: &Path,
) -> Result<CommandResponse, CommandError> {
    match command {
        Command::ReadApplications => read_applications(app_paths),
        Command::GetConfig => get_config(app_paths),
        Command::SaveConfig { root } => {
            writes::save_config(config_base, &root)?;
            Ok(CommandResponse::WriteOk { duplicate: false })
        }
        // Everything else is declared but not implemented in Phase 1.
        _ => Err(CommandError::not_implemented()),
    }
}

/// `ReadApplications`: read `data/applications.md` (fallback root-level),
/// returning the bytes verbatim as a string. Missing file → `NotFound`.
fn read_applications(app_paths: &AppPaths) -> Result<CommandResponse, CommandError> {
    let path = app_paths.applications_md();
    match std::fs::read(&path) {
        Ok(bytes) => Ok(CommandResponse::Text {
            content: String::from_utf8_lossy(&bytes).into_owned(),
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(CommandError::new(
            ErrorCode::NotFound,
            format!("applications.md not found at {}", path.display()),
        )),
        Err(e) => Err(CommandError::new(
            ErrorCode::Internal,
            format!("failed to read applications.md: {e}"),
        )),
    }
}

/// `GetConfig`: report the resolved root and the (dormant) firecrawl status.
fn get_config(app_paths: &AppPaths) -> Result<CommandResponse, CommandError> {
    Ok(CommandResponse::Config {
        root: app_paths.root.to_string_lossy().into_owned(),
        firecrawl: FirecrawlStatusDto::dormant(),
    })
}

// ---------------------------------------------------------------------------
// Tauri command entry point.
// ---------------------------------------------------------------------------

/// The single allowlisted Tauri command. The frontend invokes `dispatch` with a
/// `command` payload; Rust validates and routes it.
#[tauri::command]
pub fn dispatch(
    command: Command,
    paths_state: tauri::State<'_, AppPaths>,
    config_base: tauri::State<'_, ConfigBase>,
) -> Result<CommandResponse, CommandError> {
    handle(command, &paths_state, &config_base.0)
}

/// Managed state holding the base dir under which `config.json` lives.
pub struct ConfigBase(pub std::path::PathBuf);

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    fn make_repo_with_apps(parent: &Path, body: &str, nested: bool) -> PathBuf {
        let root = parent.join("repo");
        if nested {
            fs::create_dir_all(root.join("data")).unwrap();
            fs::write(root.join("data").join("applications.md"), body).unwrap();
        } else {
            fs::create_dir_all(&root).unwrap();
            fs::write(root.join("applications.md"), body).unwrap();
        }
        root
    }

    fn app_paths(root: PathBuf) -> AppPaths {
        AppPaths { root }
    }

    // ---- serde round-trips ----

    #[test]
    fn deser_read_applications() {
        let c: Command = serde_json::from_str(r#"{"cmd":"read_applications"}"#).unwrap();
        assert_eq!(c, Command::ReadApplications);
    }

    #[test]
    fn deser_update_status() {
        let json = r#"{"cmd":"update_status","app_number":468,"status":"Applied","notes":"sent"}"#;
        let c: Command = serde_json::from_str(json).unwrap();
        assert_eq!(
            c,
            Command::UpdateStatus {
                app_number: 468,
                status: CanonicalStatus::Applied,
                notes: Some("sent".into()),
            }
        );
    }

    #[test]
    fn deser_save_config() {
        let c: Command = serde_json::from_str(r#"{"cmd":"save_config","root":"/x"}"#).unwrap();
        assert_eq!(c, Command::SaveConfig { root: "/x".into() });
    }

    #[test]
    fn deser_unknown_cmd_fails() {
        let r: Result<Command, _> = serde_json::from_str(r#"{"cmd":"nope"}"#);
        assert!(r.is_err(), "unknown cmd must fail deserialization");
    }

    #[test]
    fn canonical_status_rejects_free_text() {
        let r: Result<CanonicalStatus, _> = serde_json::from_str(r#""Maybe""#);
        assert!(r.is_err(), "free-text status must be rejected");
        // The SKIP rename is honored.
        let s: CanonicalStatus = serde_json::from_str(r#""SKIP""#).unwrap();
        assert_eq!(s, CanonicalStatus::Skip);
        // Lowercase is also rejected (closed PascalCase set).
        let r2: Result<CanonicalStatus, _> = serde_json::from_str(r#""applied""#);
        assert!(r2.is_err());
    }

    #[test]
    fn text_serializes_with_kind_tag() {
        let resp = CommandResponse::Text {
            content: "hi".into(),
        };
        let v: serde_json::Value = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["kind"], "text");
        assert_eq!(v["content"], "hi");
    }

    #[test]
    fn error_serializes_code_snake_case() {
        let err = CommandError::new(ErrorCode::NotFound, "x");
        let v: serde_json::Value = serde_json::to_value(&err).unwrap();
        assert_eq!(v["code"], "not_found");
        assert_eq!(v["message"], "x");
    }

    #[test]
    fn lane_b_and_firecrawl_variants_round_trip() {
        let cases = [
            r#"{"cmd":"evaluate_url","url":"https://x"}"#,
            r#"{"cmd":"firecrawl_add_key","key":"k"}"#,
            r#"{"cmd":"firecrawl_remove_key","index":0}"#,
            r#"{"cmd":"firecrawl_status"}"#,
            r#"{"cmd":"firecrawl_enqueue","urls":["https://a"]}"#,
            r#"{"cmd":"queue_url","url":"https://q"}"#,
            r#"{"cmd":"run_scan","dry_run":true}"#,
            r#"{"cmd":"gen_pdf","app_number":456}"#,
            r#"{"cmd":"file_exists","glob":"output/cv-*.html"}"#,
            r#"{"cmd":"cancel_job","job_id":"j1"}"#,
        ];
        for c in cases {
            let parsed: Command = serde_json::from_str(c).unwrap();
            // Re-serialize round-trips back to a Command.
            let back = serde_json::to_string(&parsed).unwrap();
            let again: Command = serde_json::from_str(&back).unwrap();
            assert_eq!(parsed, again);
        }
    }

    // ---- handlers ----

    #[test]
    fn read_applications_data_dir_exact_bytes() {
        let tmp = tempdir().unwrap();
        let root = make_repo_with_apps(tmp.path(), "# Applications Tracker\n| a |\n", true);
        let resp = handle(Command::ReadApplications, &app_paths(root), tmp.path()).unwrap();
        match resp {
            CommandResponse::Text { content } => {
                assert_eq!(content, "# Applications Tracker\n| a |\n");
            }
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[test]
    fn read_applications_root_fallback() {
        let tmp = tempdir().unwrap();
        let root = make_repo_with_apps(tmp.path(), "ROOT LEVEL\n", false);
        let resp = handle(Command::ReadApplications, &app_paths(root), tmp.path()).unwrap();
        match resp {
            CommandResponse::Text { content } => assert_eq!(content, "ROOT LEVEL\n"),
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[test]
    fn read_applications_missing_is_not_found() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("empty");
        fs::create_dir_all(&root).unwrap();
        let err = handle(Command::ReadApplications, &app_paths(root), tmp.path()).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[test]
    fn get_config_reports_root_and_dormant_firecrawl() {
        let tmp = tempdir().unwrap();
        let root = make_repo_with_apps(tmp.path(), "x", true);
        let resp = handle(Command::GetConfig, &app_paths(root.clone()), tmp.path()).unwrap();
        match resp {
            CommandResponse::Config { root: r, firecrawl } => {
                assert_eq!(r, root.to_string_lossy());
                assert!(firecrawl.dormant);
                assert_eq!(firecrawl.keys, 0);
            }
            other => panic!("expected Config, got {other:?}"),
        }
    }

    #[test]
    fn save_config_handler_writes_readable_config() {
        let tmp = tempdir().unwrap();
        let root = make_repo_with_apps(tmp.path(), "x", true);
        let base = tmp.path().join("cfgbase");
        let resp = handle(
            Command::SaveConfig {
                root: root.to_string_lossy().into_owned(),
            },
            &app_paths(root.clone()),
            &base,
        )
        .unwrap();
        assert!(matches!(resp, CommandResponse::WriteOk { duplicate: false }));
        let cfg = paths::read_app_config(&base).unwrap().unwrap();
        assert_eq!(cfg.career_ops_root.as_deref(), Some(root.to_str().unwrap()));
    }

    #[test]
    fn unimplemented_variant_returns_internal() {
        let tmp = tempdir().unwrap();
        let root = make_repo_with_apps(tmp.path(), "x", true);
        let err = handle(Command::RunMerge, &app_paths(root), tmp.path()).unwrap_err();
        assert_eq!(err.code, ErrorCode::Internal);
        assert_eq!(err.message, "not implemented in phase 1");
    }

    // ---- golden fixtures (P1-T8 support) ----

    #[test]
    fn serialize_golden() {
        // Source of truth for the TS mirror. Writes three fixtures.
        let fixtures_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("src")
            .join("lib")
            .join("__fixtures__");
        fs::create_dir_all(&fixtures_dir).unwrap();

        let text = CommandResponse::Text {
            content: "# Applications Tracker\n".into(),
        };
        let config = CommandResponse::Config {
            root: "/Users/example/career-ops".into(),
            firecrawl: FirecrawlStatusDto::dormant(),
        };
        let error = CommandError::new(ErrorCode::NotFound, "applications.md not found");

        write_golden(&fixtures_dir.join("response-text.json"), &text);
        write_golden(&fixtures_dir.join("response-config.json"), &config);
        write_golden(&fixtures_dir.join("error-not-found.json"), &error);

        // Sanity: re-read and assert tag shape.
        let v: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(fixtures_dir.join("response-text.json")).unwrap())
                .unwrap();
        assert_eq!(v["kind"], "text");
    }

    fn write_golden<T: Serialize>(path: &Path, value: &T) {
        let json = serde_json::to_string_pretty(value).unwrap();
        fs::write(path, format!("{json}\n")).unwrap();
    }
}
