//! Sanctioned disk writes (P1-T4b skeleton; write logic lands in Phase 5).
//!
//! **This is the ONLY module permitted to write tracker files / `config.json`
//! / `.env.firecrawl`.** Every mutating filesystem operation against those
//! targets (`fs::write`, `fs::rename`, `OpenOptions::append`, `fs::copy`) must
//! live here and nowhere else. A cargo source-grep guard
//! (`tests/write_isolation.rs`) enforces this invariant: adding such a write to
//! any other module fails the test.
//!
//! Phase 1 implements exactly one writer: [`save_config`] (the `SaveConfig`
//! command's `config.json` writer, P1-T5). The two sanctioned tracker writes
//! (`QueueUrl` append to `pipeline.md` and `UpdateStatus` single-row edit)
//! land in Phase 5 and will be implemented here, atomically and with backups.

use crate::commands::{CanonicalStatus, CommandError, ErrorCode};
use crate::paths::{self, AppConfig};
use std::path::Path;

/// Atomically writes the app `config.json` under the config dir rooted at
/// `config_base`, persisting `root` as `careerOpsRoot`.
///
/// Validation: `root` must point at a directory that contains either
/// `data/applications.md` or a root-level `applications.md`; otherwise this
/// returns [`ErrorCode::InvalidArg`]. The write is atomic (temp file + rename)
/// so a crash mid-write never leaves a half-written `config.json`.
///
/// This is the SaveConfig writer (P1-T5). The app config dir is an allowed
/// non-tracker write target and is intentionally routed through this module to
/// keep all sanctioned writes in one place (C5).
pub fn save_config(config_base: &Path, root: &str) -> Result<(), CommandError> {
    let root_trimmed = root.trim();
    if root_trimmed.is_empty() {
        return Err(CommandError::new(ErrorCode::InvalidArg, "root path is empty"));
    }

    let root_path = Path::new(root_trimmed);
    if !paths::is_valid_root(root_path) {
        return Err(CommandError::new(
            ErrorCode::InvalidArg,
            format!(
                "directory does not contain applications.md: {}",
                root_trimmed
            ),
        ));
    }

    // Merge into the existing config so other keys (e.g. `evalModel`) survive.
    let mut cfg = read_existing_config(config_base);
    cfg.career_ops_root = Some(root_trimmed.to_string());
    write_config(config_base, &cfg)
}

/// Persist the eval model token into `config.json`, merging with existing keys so
/// `careerOpsRoot` is never clobbered. The atomic-write machinery is shared with
/// [`save_config`]. Validation of the token is the caller's responsibility
/// (`validate::validate_eval_model`).
pub fn save_eval_model(config_base: &Path, model: &str) -> Result<(), CommandError> {
    let mut cfg = read_existing_config(config_base);
    cfg.eval_model = Some(model.to_string());
    write_config(config_base, &cfg)
}

/// Read the existing `config.json` (under `config_base`), returning a default
/// (all-`None`) config when it is absent or unparseable. A read, not a write.
fn read_existing_config(config_base: &Path) -> AppConfig {
    paths::read_app_config(config_base)
        .ok()
        .flatten()
        .unwrap_or_default()
}

/// Atomically write `cfg` to `config.json` under `config_base` (temp + rename).
/// The single sanctioned config writer; both [`save_config`] and
/// [`save_eval_model`] route through here.
fn write_config(config_base: &Path, cfg: &AppConfig) -> Result<(), CommandError> {
    let cfg_dir = paths::app_config_dir(config_base);
    std::fs::create_dir_all(&cfg_dir).map_err(|e| {
        CommandError::new(
            ErrorCode::Internal,
            format!("failed to create config dir: {e}"),
        )
    })?;

    let serialized = serde_json::to_string_pretty(cfg).map_err(|e| {
        CommandError::new(ErrorCode::Internal, format!("failed to serialize config: {e}"))
    })?;

    let final_path = paths::app_config_path(config_base);
    let tmp_path = cfg_dir.join("config.json.tmp");

    // Atomic write: write to a sibling temp file, then rename over the target.
    std::fs::write(&tmp_path, serialized.as_bytes()).map_err(|e| {
        CommandError::new(ErrorCode::Internal, format!("failed to write temp config: {e}"))
    })?;
    std::fs::rename(&tmp_path, &final_path).map_err(|e| {
        CommandError::new(ErrorCode::Internal, format!("failed to commit config: {e}"))
    })?;

    Ok(())
}

/// Sanctioned write #2 (P5-T2): edit exactly one tracker row's `Status` cell
/// (and optionally its `Notes` cell) in `applications.md`, preserving the row's
/// exact pipe layout, column count, and every other cell byte-for-byte.
///
/// Behavior:
/// - Reads `data/applications.md` (falling back to root-level `applications.md`).
/// - Locates the single markdown table row whose first cell (`#`) equals
///   `app_number`. The header and separator rows are never matched (their first
///   cell is `#` / `---`, not a number).
/// - Rewrites ONLY the `Status` cell (column index 5: `# | Date | Company |
///   Role | Score | Status | PDF | Report | Notes`), and the `Notes` cell
///   (column index 8) when `notes` is `Some`. The exact surrounding whitespace
///   padding of the edited cell is normalized to a single leading/trailing space
///   (` label `), matching the canonical tracker format; all *other* cells and
///   all *other* lines are emitted byte-for-byte unchanged.
/// - Writes a `.bak` copy of the original file BEFORE writing, then commits the
///   new content atomically (temp file + rename).
///
/// Never adds, removes, or reorders rows; never touches the header/separator.
/// Row not found → [`ErrorCode::NotFound`]. Missing file → [`ErrorCode::NotFound`].
pub fn update_status(
    root: &Path,
    app_number: u32,
    status: CanonicalStatus,
    notes: Option<String>,
) -> Result<(), CommandError> {
    let path = paths::applications_md_path(root);

    let original = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(CommandError::new(
                ErrorCode::NotFound,
                format!("applications.md not found at {}", path.display()),
            ));
        }
        Err(e) => {
            return Err(CommandError::new(
                ErrorCode::Internal,
                format!("failed to read applications.md: {e}"),
            ));
        }
    };

    // Find the ONE row whose first data cell equals app_number, and rewrite it.
    // We iterate over the byte ranges of each line so that line endings and all
    // non-target lines are preserved byte-for-byte.
    let mut new_content = String::with_capacity(original.len() + 16);
    let mut matched = false;
    for line in split_keep_endings(&original) {
        if !matched {
            if let Some(rewritten) = rewrite_matching_row(line, app_number, status, notes.as_deref())
            {
                new_content.push_str(&rewritten);
                matched = true;
                continue;
            }
        }
        new_content.push_str(line);
    }

    if !matched {
        return Err(CommandError::new(
            ErrorCode::NotFound,
            format!("no tracker row with number {app_number}"),
        ));
    }

    // Write a .bak copy of the ORIGINAL before mutating.
    let bak_path = path.with_extension("md.bak");
    std::fs::copy(&path, &bak_path).map_err(|e| {
        CommandError::new(ErrorCode::Internal, format!("failed to write backup: {e}"))
    })?;

    // Atomic commit: temp file in the same dir, then rename over the target.
    let tmp_path = path.with_extension("md.tmp");
    std::fs::write(&tmp_path, new_content.as_bytes()).map_err(|e| {
        CommandError::new(
            ErrorCode::Internal,
            format!("failed to write temp applications.md: {e}"),
        )
    })?;
    std::fs::rename(&tmp_path, &path).map_err(|e| {
        CommandError::new(
            ErrorCode::Internal,
            format!("failed to commit applications.md: {e}"),
        )
    })?;

    Ok(())
}

/// Split `s` into lines, KEEPING each line's trailing newline (if any) attached.
/// The concatenation of the returned slices equals `s` byte-for-byte, so
/// non-target lines round-trip exactly.
fn split_keep_endings(s: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut start = 0usize;
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            out.push(&s[start..=i]);
            start = i + 1;
        }
    }
    if start < s.len() {
        out.push(&s[start..]);
    }
    out
}

/// If `line` (which may include a trailing `\n`) is a tracker table row whose
/// first cell equals `app_number`, return the rewritten line (with the same
/// trailing newline). Otherwise return `None`.
///
/// A tracker row is a pipe table line `| a | b | c | ... |`. The header row
/// (first cell `#`) and the separator row (first cell `---`) never parse as a
/// number, so they are never matched. Only the `Status` cell (index 5) and the
/// `Notes` cell (index 8, when `notes` is provided) are rewritten; all other
/// cells are preserved exactly as they appeared.
fn rewrite_matching_row(
    line: &str,
    app_number: u32,
    status: CanonicalStatus,
    notes: Option<&str>,
) -> Option<String> {
    // Separate the trailing newline so we can reattach it verbatim.
    let (body, ending) = match line.strip_suffix('\n') {
        Some(b) => (b, "\n"),
        None => (line, ""),
    };

    let trimmed = body.trim_start();
    if !trimmed.starts_with('|') {
        return None;
    }

    // Split into cells on '|'. A pipe table `| a | b |` splits to
    // ["", " a ", " b ", ""]; the first and last elements are the outer
    // delimiters' empty edges, which we preserve.
    let cells: Vec<&str> = body.split('|').collect();
    // Need at least the 9 logical columns plus the two outer empties → 11 parts.
    if cells.len() < 11 {
        return None;
    }

    // Logical column N corresponds to cells[N+1] (cells[0] is the pre-first-pipe
    // edge). Column 0 = `#`, column 5 = Status, column 8 = Notes.
    let first_cell = cells.get(1)?.trim();
    let parsed: u32 = first_cell.parse().ok()?;
    if parsed != app_number {
        return None;
    }

    let mut out_cells: Vec<String> = cells.iter().map(|c| c.to_string()).collect();
    // Status cell is logical column 5 → index 6.
    out_cells[6] = format!(" {} ", status.label());
    if let Some(note) = notes {
        // Notes cell is logical column 8 → index 9.
        out_cells[9] = format!(" {} ", note);
    }

    let mut rebuilt = out_cells.join("|");
    rebuilt.push_str(ending);
    Some(rebuilt)
}

// ---------------------------------------------------------------------------
// Sanctioned write #1 (P5-T4): queue a URL into pipeline.md.
// ---------------------------------------------------------------------------

/// Sanctioned write #1 (P5-T4): append `- [ ] {url}` to `pipeline.md` under its
/// Pending section, deduping against every URL already present in the file.
///
/// Behavior (mirrors the fork's `queue-server.mjs` insert/dedup logic):
/// - Resolves `data/pipeline.md` (falling back to root-level `pipeline.md`).
/// - DEDUP: if `url` already appears on any pending (`- [ ]`) or processed
///   (`- [x]`) checklist line, nothing is written and `Ok(true)` (duplicate) is
///   returned.
/// - Otherwise inserts `- [ ] {url}` immediately after the Pending header
///   (`## Pending` / `## Pendientes`). If no such header exists, a
///   `## Pendientes` section is appended and the item placed under it.
/// - Missing file → create it with a Pending section, then insert.
/// - The commit is atomic (temp file in the same dir, then rename).
///
/// Returns `Ok(false)` when the URL was appended, `Ok(true)` when it was a
/// duplicate (no write performed).
pub fn queue_url(root: &Path, url: &str) -> Result<bool, CommandError> {
    let path = paths::preferred_data_path(root, "pipeline.md");

    // Read existing content (missing file → empty, we'll create the section).
    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => {
            return Err(CommandError::new(
                ErrorCode::Internal,
                format!("failed to read pipeline.md: {e}"),
            ));
        }
    };

    // DEDUP: any checklist line (`- [ ]` or `- [x]`) that contains the URL wins.
    if url_already_present(&content, url) {
        return Ok(true);
    }

    let next = insert_pending(&content, url);

    // Ensure the parent dir exists (the `data/` dir when the path is nested,
    // the root otherwise). `data/` may not exist on a freshly-resolved repo.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            CommandError::new(
                ErrorCode::Internal,
                format!("failed to create pipeline dir: {e}"),
            )
        })?;
    }

    // Atomic commit: temp file in the same dir, then rename over the target.
    let tmp_path = path.with_extension("md.tmp");
    std::fs::write(&tmp_path, next.as_bytes()).map_err(|e| {
        CommandError::new(
            ErrorCode::Internal,
            format!("failed to write temp pipeline.md: {e}"),
        )
    })?;
    std::fs::rename(&tmp_path, &path).map_err(|e| {
        CommandError::new(
            ErrorCode::Internal,
            format!("failed to commit pipeline.md: {e}"),
        )
    })?;

    Ok(false)
}

/// True iff `url` appears on any checklist line (`- [ ]` or `- [x]`) in
/// `content`. Mirrors `queue-server.mjs`'s `urlAlreadyPresent`.
fn url_already_present(content: &str, url: &str) -> bool {
    content.lines().any(|l| {
        let t = l.trim_start();
        (t.starts_with("- [ ]") || t.starts_with("- [x]")) && l.contains(url)
    })
}

/// Insert `- [ ] {url}` into `content` under its Pending header. Mirrors
/// `queue-server.mjs`'s `insertPending`:
/// - If a `## Pending` / `## Pendientes` header exists, insert the item on the
///   line immediately after it.
/// - Otherwise append a `## Pendientes` section (with the item) to the end.
fn insert_pending(content: &str, url: &str) -> String {
    let item = format!("- [ ] {url}");
    let lines: Vec<&str> = content.split('\n').collect();
    let header_idx = lines.iter().position(|l| is_pending_header(l));
    match header_idx {
        None => {
            // No Pending section → append one. Trim trailing whitespace first.
            let trimmed = content.trim_end();
            format!("{trimmed}\n\n## Pendientes\n{item}\n")
        }
        Some(idx) => {
            let mut out: Vec<String> = lines.iter().map(|s| s.to_string()).collect();
            out.insert(idx + 1, item);
            out.join("\n")
        }
    }
}

/// True iff `line` is a Pending section header (`## Pending` / `## Pendientes`),
/// case-insensitive, mirroring queue-server.mjs's `PENDING_HEADER_RE`.
fn is_pending_header(line: &str) -> bool {
    let t = line.trim_start();
    let Some(rest) = t.strip_prefix("##") else {
        return false;
    };
    let rest = rest.trim_start().to_ascii_lowercase();
    rest.starts_with("pending") || rest.starts_with("pendientes")
}

// ---------------------------------------------------------------------------
// Firecrawl key storage (P5-T5): `.env.firecrawl` at the repo root.
// ---------------------------------------------------------------------------

/// The gitignored key file at the repo root. Holds `FIRECRAWL_API_KEY_{N}=...`
/// lines that `firecrawl-probe.mjs` (`loadApiKeys`) reads.
fn firecrawl_env_path(root: &Path) -> std::path::PathBuf {
    root.join(".env.firecrawl")
}

/// Read `.env.firecrawl`, returning the ordered list of configured keys (the
/// values of `FIRECRAWL_API_KEY_{N}=...` lines). Missing file → empty list.
///
/// Matches `loadApiKeys` in `providers/_firecrawl-utils.mjs`: a key line is
/// `^FIRECRAWL_API_KEY_\d+=([^\s#]+)` and the captured value (up to the first
/// whitespace or `#`) is the key. Lines are returned in file order.
pub fn firecrawl_keys(root: &Path) -> Result<Vec<String>, CommandError> {
    let path = firecrawl_env_path(root);
    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(CommandError::new(
                ErrorCode::Internal,
                format!("failed to read .env.firecrawl: {e}"),
            ));
        }
    };
    Ok(parse_firecrawl_keys(&content))
}

/// Parse the key VALUES from `.env.firecrawl` content, in file order.
fn parse_firecrawl_keys(content: &str) -> Vec<String> {
    content
        .lines()
        .filter_map(parse_firecrawl_key_line)
        .collect()
}

/// If `line` is a `FIRECRAWL_API_KEY_{N}=VALUE` line, return `VALUE` (truncated
/// at the first whitespace or `#`, matching the Node regex). Otherwise `None`.
fn parse_firecrawl_key_line(line: &str) -> Option<String> {
    let rest = line.strip_prefix("FIRECRAWL_API_KEY_")?;
    // Require at least one digit, then '='.
    let eq = rest.find('=')?;
    let digits = &rest[..eq];
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let value = &rest[eq + 1..];
    // Value is everything up to the first whitespace or '#'.
    let end = value
        .find(|c: char| c.is_whitespace() || c == '#')
        .unwrap_or(value.len());
    let value = &value[..end];
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

/// Add a Firecrawl key (P5-T5): append it as the next `FIRECRAWL_API_KEY_{N}=`
/// line in `.env.firecrawl` at the repo root.
///
/// - Validates the key looks like a Firecrawl key (`fc-` prefix, reasonable
///   length) → else [`ErrorCode::InvalidArg`].
/// - Idempotent: if the exact key value is already present, nothing is written
///   and `Ok(true)` (duplicate) is returned.
/// - Otherwise finds the max existing index `N` and appends `..._{N+1}=key`.
/// - The commit is atomic (temp file + rename). Returns `Ok(false)` on append.
pub fn firecrawl_add_key(root: &Path, key: &str) -> Result<bool, CommandError> {
    let key = key.trim();
    validate_firecrawl_key(key)?;

    let path = firecrawl_env_path(root);
    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => {
            return Err(CommandError::new(
                ErrorCode::Internal,
                format!("failed to read .env.firecrawl: {e}"),
            ));
        }
    };

    // Idempotent: exact value already present → duplicate, no write.
    if parse_firecrawl_keys(&content).iter().any(|k| k == key) {
        return Ok(true);
    }

    // Next index = max existing index + 1 (1-based; first key is _1).
    let next_index = max_firecrawl_index(&content) + 1;
    let mut next = content.clone();
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(&format!("FIRECRAWL_API_KEY_{next_index}={key}\n"));

    write_firecrawl_env(&path, &next)?;
    Ok(false)
}

/// Remove the Firecrawl key at 1-based `index` (P5-T5) and RENUMBER the
/// remaining `FIRECRAWL_API_KEY_*` lines sequentially from 1.
///
/// Non-key lines (comments, blanks, other vars) are preserved in place. An
/// `index` outside `1..=len` → [`ErrorCode::InvalidArg`]. Missing file with any
/// index → [`ErrorCode::InvalidArg`] (nothing to remove). The commit is atomic.
pub fn firecrawl_remove_key(root: &Path, index: u32) -> Result<(), CommandError> {
    if index == 0 {
        return Err(CommandError::new(
            ErrorCode::InvalidArg,
            "firecrawl key index must be >= 1 (got 0)",
        ));
    }

    let path = firecrawl_env_path(root);
    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => {
            return Err(CommandError::new(
                ErrorCode::Internal,
                format!("failed to read .env.firecrawl: {e}"),
            ));
        }
    };

    // Collect the surviving key VALUES (drop the one at the 1-based index) while
    // remembering the positions of key lines so we can rewrite in place.
    let keys = parse_firecrawl_keys(&content);
    if (index as usize) > keys.len() {
        return Err(CommandError::new(
            ErrorCode::InvalidArg,
            format!(
                "firecrawl key index out of range (1..={}): {index}",
                keys.len()
            ),
        ));
    }

    // Rebuild: emit non-key lines verbatim; for key lines, emit the surviving
    // keys in order, renumbered sequentially from 1. The removed key is skipped.
    let mut surviving: Vec<String> = Vec::with_capacity(keys.len().saturating_sub(1));
    for (i, k) in keys.iter().enumerate() {
        if (i + 1) as u32 == index {
            continue;
        }
        surviving.push(k.clone());
    }

    let had_trailing_newline = content.ends_with('\n');
    let mut out_lines: Vec<String> = Vec::new();
    let mut next_n = 1u32;
    for line in content.split('\n') {
        if parse_firecrawl_key_line(line).is_some() {
            // This was a key line. Emit the next surviving key here (if any),
            // renumbered sequentially from 1. Extra original key slots (when the
            // removed key left a gap) collapse away.
            if let Some(value) = surviving.get((next_n - 1) as usize) {
                out_lines.push(format!("FIRECRAWL_API_KEY_{next_n}={value}"));
                next_n += 1;
            }
            // else: no more surviving keys to place here → drop this slot.
        } else {
            out_lines.push(line.to_string());
        }
    }

    let mut next = out_lines.join("\n");
    if had_trailing_newline && !next.ends_with('\n') {
        next.push('\n');
    }

    write_firecrawl_env(&path, &next)?;
    Ok(())
}

/// Validate a Firecrawl key: must start `fc-` and have a reasonable length.
fn validate_firecrawl_key(key: &str) -> Result<(), CommandError> {
    if !key.starts_with("fc-") {
        return Err(CommandError::new(
            ErrorCode::InvalidArg,
            "firecrawl key must start with 'fc-'",
        ));
    }
    // `fc-` + a token. Real keys are long hex; require a sane bound and no
    // whitespace (a key line must be a single token).
    if key.len() < 8 || key.len() > 200 || key.chars().any(|c| c.is_whitespace()) {
        return Err(CommandError::new(
            ErrorCode::InvalidArg,
            "firecrawl key has an implausible length or contains whitespace",
        ));
    }
    Ok(())
}

/// The max `N` across all `FIRECRAWL_API_KEY_{N}=` lines, or 0 if none.
fn max_firecrawl_index(content: &str) -> u32 {
    content
        .lines()
        .filter_map(|line| {
            let rest = line.strip_prefix("FIRECRAWL_API_KEY_")?;
            let eq = rest.find('=')?;
            rest[..eq].parse::<u32>().ok()
        })
        .max()
        .unwrap_or(0)
}

/// Atomic write of `.env.firecrawl` (temp file in the same dir, then rename).
fn write_firecrawl_env(path: &Path, content: &str) -> Result<(), CommandError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            CommandError::new(
                ErrorCode::Internal,
                format!("failed to create dir for .env.firecrawl: {e}"),
            )
        })?;
    }
    let tmp_path = path.with_extension("firecrawl.tmp");
    std::fs::write(&tmp_path, content.as_bytes()).map_err(|e| {
        CommandError::new(
            ErrorCode::Internal,
            format!("failed to write temp .env.firecrawl: {e}"),
        )
    })?;
    std::fs::rename(&tmp_path, path).map_err(|e| {
        CommandError::new(
            ErrorCode::Internal,
            format!("failed to commit .env.firecrawl: {e}"),
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn make_valid_repo(parent: &Path) -> std::path::PathBuf {
        let root = parent.join("repo");
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(root.join("data").join("applications.md"), "# Applications Tracker\n").unwrap();
        root
    }

    #[test]
    fn save_config_writes_readable_config() {
        let tmp = tempdir().unwrap();
        let repo = make_valid_repo(tmp.path());
        let base = tmp.path().join("cfgbase");

        save_config(&base, repo.to_str().unwrap()).unwrap();

        // paths.rs can read it back.
        let cfg = paths::read_app_config(&base).unwrap().unwrap();
        assert_eq!(cfg.career_ops_root.as_deref(), Some(repo.to_str().unwrap()));
    }

    #[test]
    fn save_eval_model_writes_and_reads_back() {
        let tmp = tempdir().unwrap();
        let base = tmp.path().join("cfgbase");

        // Default before any write.
        assert_eq!(paths::read_eval_model(&base), paths::DEFAULT_EVAL_MODEL);

        save_eval_model(&base, "claude-opus-4-8").unwrap();
        assert_eq!(paths::read_eval_model(&base), "claude-opus-4-8");

        let cfg = paths::read_app_config(&base).unwrap().unwrap();
        assert_eq!(cfg.eval_model.as_deref(), Some("claude-opus-4-8"));
    }

    #[test]
    fn save_eval_model_preserves_root_and_vice_versa() {
        let tmp = tempdir().unwrap();
        let repo = make_valid_repo(tmp.path());
        let base = tmp.path().join("cfgbase");

        // root first, then model: both survive.
        save_config(&base, repo.to_str().unwrap()).unwrap();
        save_eval_model(&base, "gpt-4.1").unwrap();
        let cfg = paths::read_app_config(&base).unwrap().unwrap();
        assert_eq!(cfg.career_ops_root.as_deref(), Some(repo.to_str().unwrap()));
        assert_eq!(cfg.eval_model.as_deref(), Some("gpt-4.1"));

        // Re-saving the root must NOT clobber the model.
        save_config(&base, repo.to_str().unwrap()).unwrap();
        let cfg2 = paths::read_app_config(&base).unwrap().unwrap();
        assert_eq!(cfg2.eval_model.as_deref(), Some("gpt-4.1"), "model survives root re-save");
    }

    #[test]
    fn save_config_rejects_invalid_root() {
        let tmp = tempdir().unwrap();
        let base = tmp.path().join("cfgbase");
        let bogus = tmp.path().join("not-a-repo");
        fs::create_dir_all(&bogus).unwrap();

        let err = save_config(&base, bogus.to_str().unwrap()).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidArg);
    }

    #[test]
    fn save_config_rejects_empty_root() {
        let tmp = tempdir().unwrap();
        let base = tmp.path().join("cfgbase");
        let err = save_config(&base, "   ").unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidArg);
    }

    // ---- update_status (P5-T2) ----

    /// A realistic 4-row tracker fixture matching the real applications.md
    /// header/separator and pipe layout.
    const TRACKER_FIXTURE: &str = "# Applications Tracker\n\
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n\
|---|------|---------|------|-------|--------|-----|--------|-------|\n\
| 464 | 2026-06-01 | Later | SVP Partnerships | N/A | SKIP | ❌ | N/A | North America remote only. |\n\
| 467 | 2026-06-01 | Later | Director Partnerships | N/A | SKIP | ❌ | N/A | North America only. |\n\
| 468 | 2026-06-01 | GetYourGuide | Head of Growth | N/A | Evaluated | ❌ | N/A | 3.3/5 — Berlin leadership. |\n\
| 472 | 2026-06-01 | Spotify | Lead Growth Manager | N/A | SKIP | ❌ | N/A | B2C consumer streaming IC. |\n";

    fn make_tracker_repo(parent: &Path, body: &str) -> std::path::PathBuf {
        let root = parent.join("repo");
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(root.join("data").join("applications.md"), body).unwrap();
        root
    }

    #[test]
    fn update_status_changes_only_target_status_cell() {
        let tmp = tempdir().unwrap();
        let root = make_tracker_repo(tmp.path(), TRACKER_FIXTURE);
        let apps = root.join("data").join("applications.md");

        let original_lines: Vec<String> =
            TRACKER_FIXTURE.lines().map(|l| l.to_string()).collect();

        // Change row 468 from Evaluated → Applied (no notes change).
        update_status(&root, 468, CanonicalStatus::Applied, None).unwrap();

        let after = fs::read_to_string(&apps).unwrap();
        let after_lines: Vec<String> = after.lines().map(|l| l.to_string()).collect();

        assert_eq!(
            after_lines.len(),
            original_lines.len(),
            "row count must not change"
        );

        // CRITICAL: every line EXCEPT the target row (index 5) is byte-identical.
        for (i, (orig, now)) in original_lines.iter().zip(after_lines.iter()).enumerate() {
            if i == 5 {
                // The only changed line: status cell flips Evaluated → Applied.
                assert!(now.contains("| Applied |"), "target status should be Applied: {now}");
                assert!(!now.contains("Evaluated"), "old status must be gone: {now}");
                // Every OTHER cell on this row is preserved.
                assert!(now.contains("| GetYourGuide |"));
                assert!(now.contains("| Head of Growth |"));
                assert!(now.contains("3.3/5 — Berlin leadership."));
            } else {
                assert_eq!(orig, now, "non-target line {i} must be byte-identical");
            }
        }
    }

    #[test]
    fn update_status_writes_bak_equal_to_original() {
        let tmp = tempdir().unwrap();
        let root = make_tracker_repo(tmp.path(), TRACKER_FIXTURE);
        let apps = root.join("data").join("applications.md");
        let bak = apps.with_extension("md.bak");

        assert!(!bak.exists(), "no .bak before the write");

        update_status(&root, 464, CanonicalStatus::Applied, None).unwrap();

        assert!(bak.exists(), ".bak must be created");
        let bak_content = fs::read_to_string(&bak).unwrap();
        assert_eq!(
            bak_content, TRACKER_FIXTURE,
            ".bak must equal the original file byte-for-byte"
        );
    }

    #[test]
    fn update_status_updates_notes_when_provided() {
        let tmp = tempdir().unwrap();
        let root = make_tracker_repo(tmp.path(), TRACKER_FIXTURE);
        let apps = root.join("data").join("applications.md");

        update_status(
            &root,
            472,
            CanonicalStatus::Discarded,
            Some("Closed — withdrew.".to_string()),
        )
        .unwrap();

        let after = fs::read_to_string(&apps).unwrap();
        let row = after
            .lines()
            .find(|l| l.trim_start().starts_with("| 472 "))
            .unwrap();
        assert!(row.contains("| Discarded |"), "status updated: {row}");
        assert!(row.contains("Closed — withdrew."), "notes updated: {row}");
        assert!(
            !row.contains("B2C consumer streaming IC."),
            "old notes replaced: {row}"
        );
        // Other rows untouched.
        assert!(after.contains("| 468 | 2026-06-01 | GetYourGuide | Head of Growth | N/A | Evaluated | ❌ | N/A | 3.3/5 — Berlin leadership. |"));
    }

    #[test]
    fn update_status_unknown_number_is_not_found() {
        let tmp = tempdir().unwrap();
        let root = make_tracker_repo(tmp.path(), TRACKER_FIXTURE);
        let apps = root.join("data").join("applications.md");

        let err = update_status(&root, 999, CanonicalStatus::Applied, None).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
        // File is untouched and no .bak was created on the not-found path.
        let after = fs::read_to_string(&apps).unwrap();
        assert_eq!(after, TRACKER_FIXTURE, "file unchanged on NotFound");
        assert!(!apps.with_extension("md.bak").exists());
    }

    #[test]
    fn update_status_missing_file_is_not_found() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("empty-repo");
        fs::create_dir_all(&root).unwrap();
        let err = update_status(&root, 1, CanonicalStatus::Applied, None).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[test]
    fn update_status_never_matches_header_or_separator() {
        // A fixture where the only "row" is the header + separator; no numbered
        // data rows. Must be NotFound (header `#` / separator `---` never match).
        let tmp = tempdir().unwrap();
        let body = "# Applications Tracker\n\
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n\
|---|------|---------|------|-------|--------|-----|--------|-------|\n";
        let root = make_tracker_repo(tmp.path(), body);
        let err = update_status(&root, 0, CanonicalStatus::Applied, None).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    // ---- queue_url (P5-T4) ----

    fn make_pipeline_repo(parent: &Path, body: &str) -> std::path::PathBuf {
        let root = parent.join("repo");
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(root.join("data").join("pipeline.md"), body).unwrap();
        root
    }

    const PIPELINE_FIXTURE: &str = "# Pipeline\n\n## Pendientes\n\n## Procesadas\n";

    #[test]
    fn queue_url_appends_under_pending_once() {
        let tmp = tempdir().unwrap();
        let root = make_pipeline_repo(tmp.path(), PIPELINE_FIXTURE);
        let pipeline = root.join("data").join("pipeline.md");

        let dup = queue_url(&root, "https://jobs.example.com/123").unwrap();
        assert!(!dup, "first append is not a duplicate");

        let after = fs::read_to_string(&pipeline).unwrap();
        assert!(
            after.contains("- [ ] https://jobs.example.com/123"),
            "url appended: {after}"
        );
        // Inserted directly under the Pending header.
        let lines: Vec<&str> = after.lines().collect();
        let hdr = lines.iter().position(|l| l.trim() == "## Pendientes").unwrap();
        assert_eq!(lines[hdr + 1], "- [ ] https://jobs.example.com/123");
    }

    #[test]
    fn queue_url_dedups_repeat_pending() {
        let tmp = tempdir().unwrap();
        let root = make_pipeline_repo(tmp.path(), PIPELINE_FIXTURE);
        let pipeline = root.join("data").join("pipeline.md");

        assert!(!queue_url(&root, "https://x.io/job").unwrap());
        let dup = queue_url(&root, "https://x.io/job").unwrap();
        assert!(dup, "second identical url is a duplicate");

        let after = fs::read_to_string(&pipeline).unwrap();
        let count = after.matches("https://x.io/job").count();
        assert_eq!(count, 1, "url present exactly once: {after}");
    }

    #[test]
    fn queue_url_dedups_processed_x_line() {
        let tmp = tempdir().unwrap();
        // The url already appears as a PROCESSED (`- [x]`) entry.
        let body = "# Pipeline\n\n## Pendientes\n\n## Procesadas\n- [x] https://done.example.com/42\n";
        let root = make_pipeline_repo(tmp.path(), body);
        let pipeline = root.join("data").join("pipeline.md");

        let dup = queue_url(&root, "https://done.example.com/42").unwrap();
        assert!(dup, "url present as processed `- [x]` is a duplicate");
        // File unchanged (no new pending line added).
        let after = fs::read_to_string(&pipeline).unwrap();
        assert_eq!(after, body, "no write on duplicate");
        assert!(!after.contains("- [ ] https://done.example.com/42"));
    }

    #[test]
    fn queue_url_creates_file_and_section_when_missing() {
        let tmp = tempdir().unwrap();
        // Repo root with NO pipeline.md at all.
        let root = tmp.path().join("repo-empty");
        fs::create_dir_all(&root).unwrap();

        let dup = queue_url(&root, "https://new.example.com/1").unwrap();
        assert!(!dup);

        // Falls back to root-level pipeline.md (no data/pipeline.md existed).
        let pipeline = root.join("pipeline.md");
        assert!(pipeline.exists(), "pipeline.md created");
        let after = fs::read_to_string(&pipeline).unwrap();
        assert!(after.contains("## Pendientes"), "Pending section created: {after}");
        assert!(after.contains("- [ ] https://new.example.com/1"), "url present: {after}");
    }

    #[test]
    fn queue_url_no_pending_header_appends_section() {
        let tmp = tempdir().unwrap();
        // A pipeline file that exists but has no Pending header.
        let root = make_pipeline_repo(tmp.path(), "# Pipeline\n\nsome notes\n");
        let pipeline = root.join("data").join("pipeline.md");

        let dup = queue_url(&root, "https://noheader.example.com/9").unwrap();
        assert!(!dup);
        let after = fs::read_to_string(&pipeline).unwrap();
        assert!(after.contains("## Pendientes"), "section appended: {after}");
        assert!(after.contains("- [ ] https://noheader.example.com/9"));
        // Original content preserved.
        assert!(after.contains("some notes"));
    }

    // ---- firecrawl key management (P5-T5) ----

    fn read_env(root: &Path) -> String {
        fs::read_to_string(root.join(".env.firecrawl")).unwrap()
    }

    #[test]
    fn firecrawl_add_first_key_writes_index_1() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo");
        fs::create_dir_all(&root).unwrap();

        let dup = firecrawl_add_key(&root, "fc-abcdef0123456789").unwrap();
        assert!(!dup);
        let env = read_env(&root);
        assert!(
            env.contains("FIRECRAWL_API_KEY_1=fc-abcdef0123456789"),
            "first key is _1: {env}"
        );
        assert_eq!(firecrawl_keys(&root).unwrap(), vec!["fc-abcdef0123456789"]);
    }

    #[test]
    fn firecrawl_add_second_key_writes_index_2() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo");
        fs::create_dir_all(&root).unwrap();

        firecrawl_add_key(&root, "fc-key-one-aaaaaaaa").unwrap();
        let dup = firecrawl_add_key(&root, "fc-key-two-bbbbbbbb").unwrap();
        assert!(!dup);
        let env = read_env(&root);
        assert!(env.contains("FIRECRAWL_API_KEY_1=fc-key-one-aaaaaaaa"), "{env}");
        assert!(env.contains("FIRECRAWL_API_KEY_2=fc-key-two-bbbbbbbb"), "{env}");
        assert_eq!(firecrawl_keys(&root).unwrap().len(), 2);
    }

    #[test]
    fn firecrawl_add_key_is_idempotent() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo");
        fs::create_dir_all(&root).unwrap();

        assert!(!firecrawl_add_key(&root, "fc-dup-1234567890").unwrap());
        let dup = firecrawl_add_key(&root, "fc-dup-1234567890").unwrap();
        assert!(dup, "re-adding the same key is a duplicate");
        assert_eq!(firecrawl_keys(&root).unwrap().len(), 1, "no duplicate line");
    }

    #[test]
    fn firecrawl_add_key_rejects_non_fc() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo");
        fs::create_dir_all(&root).unwrap();

        for bad in ["", "abc-123456789", "sk-1234567890", "fc-", "fc-with space here"] {
            let err = firecrawl_add_key(&root, bad).unwrap_err();
            assert_eq!(err.code, ErrorCode::InvalidArg, "reject {bad:?}");
        }
        // No file was created on the reject path.
        assert!(!root.join(".env.firecrawl").exists());
    }

    #[test]
    fn firecrawl_remove_index_1_renumbers_remaining() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo");
        fs::create_dir_all(&root).unwrap();

        firecrawl_add_key(&root, "fc-key-one-aaaaaaaa").unwrap();
        firecrawl_add_key(&root, "fc-key-two-bbbbbbbb").unwrap();
        firecrawl_add_key(&root, "fc-key-three-cccccc").unwrap();

        firecrawl_remove_key(&root, 1).unwrap();

        let env = read_env(&root);
        // Removed key gone; remaining renumbered sequentially from 1.
        assert!(!env.contains("fc-key-one-aaaaaaaa"), "removed key gone: {env}");
        assert!(env.contains("FIRECRAWL_API_KEY_1=fc-key-two-bbbbbbbb"), "renumbered _1: {env}");
        assert!(env.contains("FIRECRAWL_API_KEY_2=fc-key-three-cccccc"), "renumbered _2: {env}");
        assert!(!env.contains("FIRECRAWL_API_KEY_3"), "no stale _3: {env}");
        assert_eq!(
            firecrawl_keys(&root).unwrap(),
            vec!["fc-key-two-bbbbbbbb", "fc-key-three-cccccc"]
        );
    }

    #[test]
    fn firecrawl_remove_key_out_of_range_is_invalid_arg() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo");
        fs::create_dir_all(&root).unwrap();
        firecrawl_add_key(&root, "fc-only-key-1234567").unwrap();

        assert_eq!(
            firecrawl_remove_key(&root, 0).unwrap_err().code,
            ErrorCode::InvalidArg
        );
        assert_eq!(
            firecrawl_remove_key(&root, 2).unwrap_err().code,
            ErrorCode::InvalidArg
        );
        // The single key is untouched.
        assert_eq!(firecrawl_keys(&root).unwrap().len(), 1);
    }

    #[test]
    fn firecrawl_keys_counts_and_dormant_state() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo");
        fs::create_dir_all(&root).unwrap();

        // 0 keys → empty (dormant true is derived by the handler).
        assert_eq!(firecrawl_keys(&root).unwrap().len(), 0);

        firecrawl_add_key(&root, "fc-aaaa-1111-2222").unwrap();
        firecrawl_add_key(&root, "fc-bbbb-3333-4444").unwrap();
        assert_eq!(firecrawl_keys(&root).unwrap().len(), 2);
    }

    #[test]
    fn firecrawl_keys_parses_real_world_env_with_comments() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo");
        fs::create_dir_all(&root).unwrap();
        // Comment lines, blanks, and a trailing inline comment after a value.
        let body = "# Firecrawl keys\n\
FIRECRAWL_API_KEY_1=fc-realkey-aaaaaaaa\n\
\n\
# second account\n\
FIRECRAWL_API_KEY_2=fc-realkey-bbbbbbbb # acct B\n";
        fs::write(root.join(".env.firecrawl"), body).unwrap();
        assert_eq!(
            firecrawl_keys(&root).unwrap(),
            vec!["fc-realkey-aaaaaaaa", "fc-realkey-bbbbbbbb"]
        );
    }
}
