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

use crate::commands::{CommandError, ErrorCode};
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
}
