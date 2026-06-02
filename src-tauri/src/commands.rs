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
        // --- Phase 2: additional reads ---
        Command::ReadPipeline => read_pipeline(app_paths),
        Command::ReadScanHistory => read_scan_history(app_paths),
        Command::ListReports => list_reports(app_paths),
        Command::ReadReport { id } => read_report(app_paths, &id),
        // --- Phase 5: the sanctioned UpdateStatus write (P5-T2) ---
        Command::UpdateStatus {
            app_number,
            status,
            notes,
        } => {
            // Validate inputs through the P5-T1 choke point. `status` is already
            // a closed `CanonicalStatus` off the wire; re-run it through
            // `validate_status` so the single validated value is what reaches the
            // writer (defense in depth: the label round-trips exactly).
            crate::validate::validate_app_number(app_number)?;
            let status = crate::validate::validate_status(status.label())?;
            writes::update_status(&app_paths.root, app_number, status, notes)?;
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

/// Read a UTF-8-lossy file at `path`. A missing file is **not** an error — it
/// yields an empty `Text` response, matching the read-only viewer's contract
/// that pipeline/scan tabs render an empty state rather than a hard failure.
fn read_optional_text(path: &Path) -> Result<CommandResponse, CommandError> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(CommandResponse::Text {
            content: String::from_utf8_lossy(&bytes).into_owned(),
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(CommandResponse::Text { content: String::new() })
        }
        Err(e) => Err(CommandError::new(
            ErrorCode::Internal,
            format!("failed to read {}: {e}", path.display()),
        )),
    }
}

/// `ReadPipeline`: read `data/pipeline.md` (fallback root-level). Missing file →
/// empty `Text` (not an error).
fn read_pipeline(app_paths: &AppPaths) -> Result<CommandResponse, CommandError> {
    read_optional_text(&app_paths.pipeline_md())
}

/// `ReadScanHistory`: read `data/scan-history.tsv` (fallback root-level).
/// Missing file → empty `Text` (not an error).
fn read_scan_history(app_paths: &AppPaths) -> Result<CommandResponse, CommandError> {
    read_optional_text(&app_paths.scan_history_tsv())
}

/// True iff `name` matches the canonical report filename shape
/// `{###}-{slug}-{YYYY-MM-DD}.md` (slug = lowercase alphanumerics + hyphens).
fn is_report_filename(name: &str) -> bool {
    matches_report_id(name.strip_suffix(".md").unwrap_or(""))
}

/// True iff `id` matches `^\d{3}-[a-z0-9-]+-\d{4}-\d{2}-\d{2}$`.
///
/// Hand-rolled (no regex dependency): three leading digits, a hyphen, a slug of
/// `[a-z0-9-]+`, then `-YYYY-MM-DD`. The slug is greedy but the trailing
/// `-\d{4}-\d{2}-\d{2}` is pinned to the end, so the date shape is enforced.
fn matches_report_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    // Minimal length: 3 digits + '-' + 1 slug char + "-YYYY-MM-DD" (11) = 16.
    if bytes.len() < 16 {
        return false;
    }
    // Leading three digits.
    if !bytes[0..3].iter().all(u8::is_ascii_digit) {
        return false;
    }
    if bytes[3] != b'-' {
        return false;
    }
    // Trailing date: "-YYYY-MM-DD" occupies the last 11 bytes.
    let date = &bytes[bytes.len() - 11..];
    let date_ok = date[0] == b'-'
        && date[1..5].iter().all(u8::is_ascii_digit)
        && date[5] == b'-'
        && date[6..8].iter().all(u8::is_ascii_digit)
        && date[8] == b'-'
        && date[9..11].iter().all(u8::is_ascii_digit);
    if !date_ok {
        return false;
    }
    // Slug: everything between the leading "ddd-" and the trailing date.
    let slug = &bytes[4..bytes.len() - 11];
    if slug.is_empty() {
        return false;
    }
    slug.iter()
        .all(|&b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `ListReports`: list `reports/*.md` matching the canonical filename pattern,
/// returning `{id, filename}` per entry sorted DESCENDING by filename.
/// Non-matching files (`.DS_Store`, `README.md`, …) are silently skipped. A
/// missing `reports/` dir yields an empty list (not an error).
fn list_reports(app_paths: &AppPaths) -> Result<CommandResponse, CommandError> {
    let dir = app_paths.reports_dir();
    let entries = match std::fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CommandResponse::Reports { items: Vec::new() });
        }
        Err(e) => {
            return Err(CommandError::new(
                ErrorCode::Internal,
                format!("failed to list reports at {}: {e}", dir.display()),
            ));
        }
    };

    let mut items: Vec<ReportMeta> = Vec::new();
    for entry in entries.flatten() {
        let filename = match entry.file_name().into_string() {
            Ok(name) => name,
            Err(_) => continue, // non-UTF-8 filename → skip silently
        };
        if !is_report_filename(&filename) {
            continue;
        }
        let id = filename
            .strip_suffix(".md")
            .unwrap_or(&filename)
            .to_string();
        items.push(ReportMeta { id, filename });
    }

    // Sort DESCENDING by filename.
    items.sort_by(|a, b| b.filename.cmp(&a.filename));

    Ok(CommandResponse::Reports { items })
}

/// `ReadReport { id }`: SECURITY-CRITICAL. Validate `id` against the report-id
/// regex, resolve `reports/{id}.md`, and assert the resolved path is contained
/// within the canonicalized reports directory (blocking `../` traversal). The
/// reports *directory* is canonicalized (it exists); the file may not, so it is
/// never canonicalized directly. Missing file → `NotFound`.
fn read_report(app_paths: &AppPaths, id: &str) -> Result<CommandResponse, CommandError> {
    // 1. Validate the id shape. This alone rejects `../`, `/`, and bad dates,
    //    but containment below is the load-bearing security check.
    if !matches_report_id(id) {
        return Err(CommandError::new(
            ErrorCode::InvalidArg,
            format!("invalid report id: {id:?}"),
        ));
    }

    let reports_dir = app_paths.reports_dir();

    // 2. Canonicalize the DIRECTORY (it must exist). If it doesn't, there are
    //    no reports to read → NotFound.
    let canonical_dir = match reports_dir.canonicalize() {
        Ok(d) => d,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(CommandError::new(
                ErrorCode::NotFound,
                format!("report not found: {id}"),
            ));
        }
        Err(e) => {
            return Err(CommandError::new(
                ErrorCode::Internal,
                format!("failed to resolve reports dir: {e}"),
            ));
        }
    };

    // 3. Resolve the target file under the canonical dir and assert prefix
    //    containment. The id is regex-validated to a single path segment, so the
    //    join cannot introduce `..`; this is a defense-in-depth assertion.
    let target = canonical_dir.join(format!("{id}.md"));
    if !target.starts_with(&canonical_dir) {
        return Err(CommandError::new(
            ErrorCode::InvalidArg,
            format!("report id escapes reports directory: {id:?}"),
        ));
    }

    // 4. If the file exists, canonicalize it and re-assert containment so a
    //    symlink inside reports/ pointing outside the dir is rejected even
    //    though the id passed the regex. A missing file → NotFound.
    match target.canonicalize() {
        Ok(canonical_target) => {
            if !canonical_target.starts_with(&canonical_dir) {
                return Err(CommandError::new(
                    ErrorCode::InvalidArg,
                    format!("report id escapes reports directory: {id:?}"),
                ));
            }
            match std::fs::read(&canonical_target) {
                Ok(bytes) => Ok(CommandResponse::Text {
                    content: String::from_utf8_lossy(&bytes).into_owned(),
                }),
                Err(e) => Err(CommandError::new(
                    ErrorCode::Internal,
                    format!("failed to read report {id}: {e}"),
                )),
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(CommandError::new(
            ErrorCode::NotFound,
            format!("report not found: {id}"),
        )),
        Err(e) => Err(CommandError::new(
            ErrorCode::Internal,
            format!("failed to resolve report {id}: {e}"),
        )),
    }
}

// ---------------------------------------------------------------------------
// Tauri command entry point.
// ---------------------------------------------------------------------------

/// The single allowlisted Tauri command. The frontend invokes `dispatch` with a
/// `command` payload; Rust validates and routes it.
///
/// Most variants route through the pure [`handle`] function. The job-control
/// variants (`CancelJob`, and later the `Run*`/`EvaluateUrl` spawners) need the
/// live [`JobRegistry`] / `AppHandle`, which the pure `handle` does not carry,
/// so they are dispatched here at the Tauri layer.
#[tauri::command]
pub fn dispatch(
    app: tauri::AppHandle,
    command: Command,
    paths_state: tauri::State<'_, AppPaths>,
    config_base: tauri::State<'_, ConfigBase>,
    registry: tauri::State<'_, crate::sidecar::JobRegistry>,
) -> Result<CommandResponse, CommandError> {
    match command {
        // Cancel a running job's process group. Unknown ids are a no-op Ok.
        Command::CancelJob { job_id } => {
            registry.cancel(&job_id)?;
            Ok(CommandResponse::WriteOk { duplicate: false })
        }

        // --- Phase 3: Lane A (zero-token Node scripts) ---
        // Every Run* spawns `node <script>.mjs` with cwd = resolved repo root
        // (C1: scan and the trackers are cwd-driven, not CAREER_OPS_PATH-driven).
        Command::RunScan { dry_run, company } => {
            let mut args = vec!["scan.mjs".to_string()];
            if dry_run {
                args.push("--dry-run".to_string());
            }
            if let Some(c) = company {
                let c = validate_company(&c)?;
                args.push("--company".to_string());
                args.push(c);
            }
            spawn_node(&app, &registry, &paths_state, &args)
        }
        Command::RunMerge => {
            spawn_node(&app, &registry, &paths_state, &["merge-tracker.mjs".to_string()])
        }
        Command::RunDedup => {
            spawn_node(&app, &registry, &paths_state, &["dedup-tracker.mjs".to_string()])
        }
        Command::RunPatterns => {
            spawn_node(&app, &registry, &paths_state, &["analyze-patterns.mjs".to_string()])
        }
        Command::RunFollowup => {
            spawn_node(&app, &registry, &paths_state, &["followup-cadence.mjs".to_string()])
        }
        Command::RunVerifyPipeline => {
            spawn_node(&app, &registry, &paths_state, &["verify-pipeline.mjs".to_string()])
        }

        // GenPdf/GenLatex: glob the newest matching INPUT, DERIVE the output path
        // from the input stem (C2 — output is never globbed).
        Command::GenPdf { app_number } => {
            crate::validate::validate_app_number(app_number)?;
            let input = newest_output_match(
                &paths_state.root,
                &format!("cv-{app_number}-"),
                "html",
            )?;
            let output = input.with_extension("pdf");
            let args = vec![
                "generate-pdf.mjs".to_string(),
                input.to_string_lossy().into_owned(),
                output.to_string_lossy().into_owned(),
            ];
            spawn_node(&app, &registry, &paths_state, &args)
        }
        Command::GenLatex { app_number } => {
            crate::validate::validate_app_number(app_number)?;
            let input = newest_output_match(
                &paths_state.root,
                &format!("cv-{app_number}-"),
                "tex",
            )?;
            // generate-latex.mjs: argv[2]=input, argv[3]=optional derived output.
            let output = input.with_extension("pdf");
            let args = vec![
                "generate-latex.mjs".to_string(),
                input.to_string_lossy().into_owned(),
                output.to_string_lossy().into_owned(),
            ];
            spawn_node(&app, &registry, &paths_state, &args)
        }

        // --- Phase 5 (Lane B): the sanctioned QueueUrl write (P5-T4) ---
        Command::QueueUrl { url } => {
            crate::validate::validate_url(&url)?;
            let duplicate = writes::queue_url(&paths_state.root, &url)?;
            Ok(CommandResponse::WriteOk { duplicate })
        }

        // --- Phase 5: Firecrawl key management + run (P5-T5/T6) ---
        Command::FirecrawlAddKey { key } => {
            let duplicate = writes::firecrawl_add_key(&paths_state.root, &key)?;
            Ok(CommandResponse::WriteOk { duplicate })
        }
        Command::FirecrawlRemoveKey { index } => {
            writes::firecrawl_remove_key(&paths_state.root, index)?;
            Ok(CommandResponse::WriteOk { duplicate: false })
        }
        Command::FirecrawlStatus => {
            let count = writes::firecrawl_keys(&paths_state.root)?.len() as u32;
            Ok(CommandResponse::FirecrawlStatus {
                status: FirecrawlStatusDto {
                    keys: count,
                    cooling_down: 0,
                    queue_len: 0,
                    dormant: count == 0,
                },
            })
        }
        // FirecrawlEnqueue RUNS the existing Node scraper (firecrawl-probe.mjs),
        // which reads `.env.firecrawl` and appends to pipeline.md itself. We only
        // gate on "at least one key configured" and spawn it (cwd = repo root,
        // hydrated env so `node` + the keys resolve). A single validated
        // `--company` arg is forwarded when exactly one URL/company is supplied;
        // otherwise the probe runs over all unknown companies.
        Command::FirecrawlEnqueue { urls } => {
            let keys = writes::firecrawl_keys(&paths_state.root)?;
            if keys.is_empty() {
                return Err(CommandError::new(
                    ErrorCode::InvalidArg,
                    "no Firecrawl keys configured",
                ));
            }
            let mut args = vec!["firecrawl-probe.mjs".to_string()];
            // The probe takes `--company NAME`, not raw URLs. When exactly one
            // value is supplied, forward it as a validated company filter; with
            // zero or many, run the probe over all unknown companies.
            if urls.len() == 1 {
                let company = validate_company(&urls[0])?;
                args.push("--company".to_string());
                args.push(company);
            }
            spawn_node(&app, &registry, &paths_state, &args)
        }

        // --- Phase 5 (Lane B): headless eval of a URL ---
        Command::EvaluateUrl { url } => {
            crate::validate::validate_url(&url)?;
            let claude = crate::env::require_claude()?;
            let args = vec![
                "-p".to_string(),
                format!("/career-ops oferta {url}"),
            ];
            let job_id = crate::sidecar::spawn_job(
                &app,
                &registry,
                &claude.to_string_lossy(),
                &args,
                &paths_state.root,
            )?;
            Ok(CommandResponse::JobStarted { job_id })
        }

        other => handle(other, &paths_state, &config_base.0),
    }
}

/// Resolve `node` against the hydrated login-shell PATH and spawn it with `args`
/// in the repo root (the cwd every Lane-A script expects). The first element of
/// `args` is the script filename relative to the root.
fn spawn_node(
    app: &tauri::AppHandle,
    registry: &crate::sidecar::JobRegistry,
    paths: &AppPaths,
    args: &[String],
) -> Result<CommandResponse, CommandError> {
    // `node` must come from the hydrated env (a bundled `.app` has a truncated
    // PATH that omits the user's node install), same path sidecar already uses.
    let node = crate::env::require_binary(crate::env::hydrated_env(), "node")?;
    let job_id = crate::sidecar::spawn_job(
        app,
        registry,
        &node.to_string_lossy(),
        args,
        &paths.root,
    )?;
    Ok(CommandResponse::JobStarted { job_id })
}

/// Validate a `--company` argument against a tight charset so it can never carry
/// shell metacharacters (defense in depth — the spawner is argv-only anyway).
/// Allowed: letters, digits, space, `. & ' -`. Empty / out-of-charset → InvalidArg.
fn validate_company(company: &str) -> Result<String, CommandError> {
    let trimmed = company.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            ErrorCode::InvalidArg,
            "company is empty",
        ));
    }
    let ok = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '&' | '\'' | '-'));
    if !ok {
        return Err(CommandError::new(
            ErrorCode::InvalidArg,
            format!("company contains disallowed characters: {company:?}"),
        ));
    }
    Ok(trimmed.to_string())
}

/// Find the newest (by mtime) file under `<root>/output/` whose filename starts
/// with `prefix` and ends with `.{ext}`. Returns the absolute path or a
/// [`ErrorCode::NotFound`] error when nothing matches (so the caller does NOT
/// spawn). This is the input side of GenPdf/GenLatex; the output is derived from
/// the returned stem by the caller.
fn newest_output_match(
    root: &Path,
    prefix: &str,
    ext: &str,
) -> Result<std::path::PathBuf, CommandError> {
    let dir = root.join("output");
    let suffix = format!(".{ext}");
    let entries = match std::fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(CommandError::new(
                ErrorCode::NotFound,
                format!("no {ext} input found for {prefix}* (output/ missing)"),
            ));
        }
        Err(e) => {
            return Err(CommandError::new(
                ErrorCode::Internal,
                format!("failed to read output dir {}: {e}", dir.display()),
            ));
        }
    };

    let mut best: Option<(std::time::SystemTime, std::path::PathBuf)> = None;
    for entry in entries.flatten() {
        let name = match entry.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue,
        };
        if !name.starts_with(prefix) || !name.ends_with(&suffix) {
            continue;
        }
        let path = entry.path();
        let mtime = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        match &best {
            Some((best_mtime, _)) if *best_mtime >= mtime => {}
            _ => best = Some((mtime, path)),
        }
    }

    best.map(|(_, p)| p).ok_or_else(|| {
        CommandError::new(
            ErrorCode::NotFound,
            format!("no {ext} input found matching {prefix}* in {}", dir.display()),
        )
    })
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

// ---------------------------------------------------------------------------
// Phase 2 tests (P2-T12): containment + id regex + empty-file + listing.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod p2_tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    /// Build a repo root with a `reports/` dir and the given report files.
    fn make_repo_with_reports(parent: &Path, files: &[(&str, &str)]) -> PathBuf {
        let root = parent.join("repo");
        let reports = root.join("reports");
        fs::create_dir_all(&reports).expect("create reports dir");
        for (name, body) in files {
            fs::write(reports.join(name), body).expect("write report");
        }
        root
    }

    fn app_paths(root: PathBuf) -> AppPaths {
        AppPaths { root }
    }

    fn text_of(resp: CommandResponse) -> String {
        match resp {
            CommandResponse::Text { content } => content,
            other => panic!("expected Text, got {other:?}"),
        }
    }

    // ---- read_report: ~10 valid ids resolve inside reports/ ----

    #[test]
    fn read_report_valid_ids_resolve_inside_reports() {
        let tmp = tempdir().unwrap();
        let valid_ids = [
            "001-acme-2026-01-01",
            "042-getyourguide-2026-06-01",
            "100-some-long-company-name-2025-12-31",
            "468-cohere-ai-2026-02-28",
            "007-x-2024-03-15",
            "999-a1b2c3-2023-11-09",
            "250-data-eng-co-2026-04-30",
            "300-foo-bar-baz-2026-05-20",
            "123-acme2-2026-07-04",
            "555-multi-word-slug-here-2026-08-08",
        ];
        let files: Vec<(String, &str)> = valid_ids
            .iter()
            .map(|id| (format!("{id}.md"), "# report body"))
            .collect();
        let refs: Vec<(&str, &str)> =
            files.iter().map(|(n, b)| (n.as_str(), *b)).collect();
        let root = make_repo_with_reports(tmp.path(), &refs);
        let paths = app_paths(root);

        for id in valid_ids {
            let resp = read_report(&paths, id)
                .unwrap_or_else(|e| panic!("valid id {id} should resolve, got {e:?}"));
            assert_eq!(text_of(resp), "# report body", "body mismatch for {id}");
        }
    }

    // ---- read_report: ~8 invalid ids → InvalidArg ----

    #[test]
    fn read_report_invalid_ids_rejected_as_invalid_arg() {
        let tmp = tempdir().unwrap();
        // A populated reports dir so failures are about the id, not a missing dir.
        let root = make_repo_with_reports(
            tmp.path(),
            &[("001-acme-2026-01-01.md", "x")],
        );
        let paths = app_paths(root);

        let invalid_ids = [
            "../../etc/passwd",              // traversal
            "../001-acme-2026-01-01",        // traversal prefix
            "001-acme-2026-1-1",             // wrong date shape (single digits)
            "01-acme-2026-01-01",            // only two leading digits
            "abc-acme-2026-01-01",           // non-digit prefix
            "001-Acme-2026-01-01",           // uppercase in slug
            "001-acme-2026-13",              // truncated / wrong date
            "001--2026-01-01",               // empty slug
            "001-acme-2026-01-01/../secret", // embedded traversal
        ];

        for id in invalid_ids {
            let err = read_report(&paths, id)
                .expect_err(&format!("id {id:?} must be rejected"));
            assert_eq!(
                err.code,
                ErrorCode::InvalidArg,
                "id {id:?} should be InvalidArg, got {err:?}"
            );
        }
    }

    // ---- read_report: regex-valid id whose resolved path escapes is rejected ----

    #[cfg(unix)]
    #[test]
    fn read_report_symlink_escape_is_rejected_even_when_regex_valid() {
        use std::os::unix::fs::symlink;

        let tmp = tempdir().unwrap();
        // Secret outside the reports dir.
        let secret = tmp.path().join("secret.md");
        fs::write(&secret, "TOP SECRET").unwrap();

        let root = make_repo_with_reports(tmp.path(), &[]);
        let reports = root.join("reports");
        // A regex-valid filename that is actually a symlink pointing outside.
        let id = "001-escape-2026-01-01";
        symlink(&secret, reports.join(format!("{id}.md"))).unwrap();

        let paths = app_paths(root);
        let err = read_report(&paths, id).expect_err("symlink escape must be rejected");
        assert_eq!(err.code, ErrorCode::InvalidArg);
    }

    #[test]
    fn read_report_missing_file_is_not_found() {
        let tmp = tempdir().unwrap();
        let root = make_repo_with_reports(tmp.path(), &[("001-acme-2026-01-01.md", "x")]);
        let paths = app_paths(root);
        // Regex-valid id, but no such file.
        let err = read_report(&paths, "002-ghost-2026-01-01").unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[test]
    fn read_report_missing_reports_dir_is_not_found() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo-no-reports");
        fs::create_dir_all(&root).unwrap();
        let paths = app_paths(root);
        let err = read_report(&paths, "001-acme-2026-01-01").unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    // ---- list_reports: filters junk, sorted descending ----

    #[test]
    fn list_reports_filters_and_sorts_descending() {
        let tmp = tempdir().unwrap();
        let root = make_repo_with_reports(
            tmp.path(),
            &[
                ("001-acme-2026-01-01.md", "a"),
                ("042-getyourguide-2026-06-01.md", "b"),
                ("100-cohere-2026-03-15.md", "c"),
                (".DS_Store", "junk"),
                ("README.md", "# readme"),
                ("notes.md", "not a report"),
                ("draft.txt", "x"),
            ],
        );
        let paths = app_paths(root);

        let resp = list_reports(&paths).unwrap();
        let items = match resp {
            CommandResponse::Reports { items } => items,
            other => panic!("expected Reports, got {other:?}"),
        };

        // Only the three canonical reports survive.
        assert_eq!(items.len(), 3, "junk and non-report files must be skipped");
        let filenames: Vec<&str> = items.iter().map(|m| m.filename.as_str()).collect();
        assert!(!filenames.contains(&".DS_Store"));
        assert!(!filenames.contains(&"README.md"));
        assert!(!filenames.contains(&"notes.md"));

        // Sorted DESCENDING by filename.
        assert_eq!(items[0].filename, "100-cohere-2026-03-15.md");
        assert_eq!(items[1].filename, "042-getyourguide-2026-06-01.md");
        assert_eq!(items[2].filename, "001-acme-2026-01-01.md");

        // id == filename without ".md".
        assert_eq!(items[0].id, "100-cohere-2026-03-15");
    }

    #[test]
    fn list_reports_missing_dir_is_empty_list() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo-no-reports");
        fs::create_dir_all(&root).unwrap();
        let paths = app_paths(root);
        let resp = list_reports(&paths).unwrap();
        match resp {
            CommandResponse::Reports { items } => assert!(items.is_empty()),
            other => panic!("expected empty Reports, got {other:?}"),
        }
    }

    // ---- read_pipeline / read_scan_history: missing → empty Text ----

    #[test]
    fn read_pipeline_missing_is_empty_text_not_error() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo-empty");
        fs::create_dir_all(&root).unwrap();
        let paths = app_paths(root);
        let resp = read_pipeline(&paths).expect("missing pipeline must not error");
        assert_eq!(text_of(resp), "");
    }

    #[test]
    fn read_pipeline_data_dir_then_root_fallback() {
        // data/ variant.
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo");
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(root.join("data").join("pipeline.md"), "DATA PIPE\n").unwrap();
        let resp = read_pipeline(&app_paths(root)).unwrap();
        assert_eq!(text_of(resp), "DATA PIPE\n");

        // root-level fallback.
        let tmp2 = tempdir().unwrap();
        let root2 = tmp2.path().join("repo2");
        fs::create_dir_all(&root2).unwrap();
        fs::write(root2.join("pipeline.md"), "ROOT PIPE\n").unwrap();
        let resp2 = read_pipeline(&app_paths(root2)).unwrap();
        assert_eq!(text_of(resp2), "ROOT PIPE\n");
    }

    #[test]
    fn read_scan_history_missing_is_empty_text_not_error() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo-empty");
        fs::create_dir_all(&root).unwrap();
        let paths = app_paths(root);
        let resp = read_scan_history(&paths).expect("missing scan history must not error");
        assert_eq!(text_of(resp), "");
    }

    #[test]
    fn read_scan_history_reads_data_dir_content() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo");
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(
            root.join("data").join("scan-history.tsv"),
            "url\tportal\ncol\n",
        )
        .unwrap();
        let resp = read_scan_history(&app_paths(root)).unwrap();
        assert_eq!(text_of(resp), "url\tportal\ncol\n");
    }

    // ---- via the dispatch `handle` entry point ----

    #[test]
    fn handle_routes_phase2_reads() {
        let tmp = tempdir().unwrap();
        let root = make_repo_with_reports(tmp.path(), &[("001-acme-2026-01-01.md", "body")]);
        let paths = app_paths(root);
        let base = tmp.path();

        // ReadReport via handle.
        let resp = handle(
            Command::ReadReport {
                id: "001-acme-2026-01-01".into(),
            },
            &paths,
            base,
        )
        .unwrap();
        assert_eq!(text_of(resp), "body");

        // ListReports via handle.
        let resp = handle(Command::ListReports, &paths, base).unwrap();
        assert!(matches!(resp, CommandResponse::Reports { .. }));

        // ReadPipeline (missing) via handle → empty Text.
        let resp = handle(Command::ReadPipeline, &paths, base).unwrap();
        assert_eq!(text_of(resp), "");
    }

    // ---- unit coverage of the id matcher ----

    #[test]
    fn matches_report_id_unit() {
        assert!(matches_report_id("001-acme-2026-01-01"));
        assert!(matches_report_id("468-multi-word-slug-2026-12-31"));
        assert!(!matches_report_id("01-acme-2026-01-01"));
        assert!(!matches_report_id("001-Acme-2026-01-01"));
        assert!(!matches_report_id("001--2026-01-01"));
        assert!(!matches_report_id("../../etc/passwd"));
        assert!(!matches_report_id("001-acme-2026-1-1"));
        assert!(!matches_report_id(""));
        assert!(is_report_filename("001-acme-2026-01-01.md"));
        assert!(!is_report_filename("README.md"));
        assert!(!is_report_filename("001-acme-2026-01-01")); // no .md
    }
}

// ---------------------------------------------------------------------------
// Phase 3 tests (P3-T2): Lane-A argv gates — company injection reject +
// GenPdf/GenLatex input glob (newest mtime) with DERIVED output.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod p3_tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    // ---- validate_company: charset + injection ----

    #[test]
    fn company_accepts_normal_names() {
        for ok in ["Cohere", "Hugging Face", "AT&T", "O'Reilly", "Foo-Bar", "Acme 2.0"] {
            assert!(validate_company(ok).is_ok(), "should accept {ok:?}");
        }
        // Trimming.
        assert_eq!(validate_company("  Cohere  ").unwrap(), "Cohere");
    }

    #[test]
    fn company_rejects_injection_and_empty() {
        for bad in [
            "",
            "   ",
            "\"; rm -rf \"",     // shell injection attempt
            "Cohere; ls",        // semicolon
            "$(whoami)",         // command substitution
            "a`b`",              // backticks
            "a|b",               // pipe
            "a&&b",              // chained &&  (the & is allowed but '&&' is too? '&' is allowed; this is allowed)
        ] {
            // Note '&&' is composed of two allowed '&' chars, so it is NOT rejected
            // by charset; only metachars outside the allow-set are. Skip that case.
            if bad == "a&&b" {
                assert!(validate_company(bad).is_ok());
                continue;
            }
            assert_eq!(
                validate_company(bad).unwrap_err().code,
                ErrorCode::InvalidArg,
                "expected reject for {bad:?}"
            );
        }
    }

    // ---- newest_output_match: glob input, newest mtime, NotFound when absent ----

    fn make_repo_with_output(parent: &Path, files: &[&str]) -> PathBuf {
        let root = parent.join("repo");
        let out = root.join("output");
        fs::create_dir_all(&out).unwrap();
        for f in files {
            fs::write(out.join(f), "x").unwrap();
        }
        root
    }

    #[test]
    fn genpdf_input_glob_matches_html_prefix() {
        let tmp = tempdir().unwrap();
        let root = make_repo_with_output(
            tmp.path(),
            &["cv-456-acme.html", "cv-457-other.html", "cv-456-acme.pdf"],
        );
        let input = newest_output_match(&root, "cv-456-", "html").unwrap();
        assert_eq!(input.file_name().unwrap().to_str().unwrap(), "cv-456-acme.html");
        // Derived output is the stem with .pdf (what the caller spawns as argv[3]).
        assert_eq!(
            input.with_extension("pdf").file_name().unwrap().to_str().unwrap(),
            "cv-456-acme.pdf"
        );
    }

    #[test]
    fn genpdf_picks_newest_mtime_when_multiple_match() {
        use std::thread::sleep;
        use std::time::Duration;
        let tmp = tempdir().unwrap();
        let root = make_repo_with_output(tmp.path(), &["cv-456-v1.html"]);
        let out = root.join("output");
        // Write a second match later so it has a strictly newer mtime.
        sleep(Duration::from_millis(20));
        fs::write(out.join("cv-456-v2.html"), "newer").unwrap();

        let input = newest_output_match(&root, "cv-456-", "html").unwrap();
        assert_eq!(
            input.file_name().unwrap().to_str().unwrap(),
            "cv-456-v2.html",
            "must pick the newest-mtime match"
        );
    }

    #[test]
    fn genlatex_input_glob_matches_tex_prefix_and_derives_pdf() {
        let tmp = tempdir().unwrap();
        let root = make_repo_with_output(tmp.path(), &["cv-789-data.tex", "cv-789-data.html"]);
        let input = newest_output_match(&root, "cv-789-", "tex").unwrap();
        assert_eq!(input.file_name().unwrap().to_str().unwrap(), "cv-789-data.tex");
        assert_eq!(
            input.with_extension("pdf").file_name().unwrap().to_str().unwrap(),
            "cv-789-data.pdf"
        );
    }

    #[test]
    fn no_input_match_is_not_found() {
        let tmp = tempdir().unwrap();
        // output/ exists but nothing matches the prefix.
        let root = make_repo_with_output(tmp.path(), &["cv-999-x.html"]);
        let err = newest_output_match(&root, "cv-456-", "html").unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[test]
    fn missing_output_dir_is_not_found() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo-no-output");
        fs::create_dir_all(&root).unwrap();
        let err = newest_output_match(&root, "cv-456-", "html").unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }
}
