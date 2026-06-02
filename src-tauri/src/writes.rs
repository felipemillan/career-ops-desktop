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

    let cfg_dir = paths::app_config_dir(config_base);
    std::fs::create_dir_all(&cfg_dir).map_err(|e| {
        CommandError::new(
            ErrorCode::Internal,
            format!("failed to create config dir: {e}"),
        )
    })?;

    let cfg = AppConfig {
        career_ops_root: Some(root_trimmed.to_string()),
    };
    let serialized = serde_json::to_string_pretty(&cfg).map_err(|e| {
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
}
