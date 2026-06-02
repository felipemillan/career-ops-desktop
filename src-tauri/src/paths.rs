//! Repo-root resolution and app-config access (P1-T3).
//!
//! Resolves the career-ops repo root using a 3-tier priority:
//!   1. `CAREER_OPS_PATH` environment variable
//!   2. `careerOpsRoot` key in the app `config.json`
//!   3. default sibling `../career-ops`
//!
//! A candidate root is valid iff it contains `data/applications.md` OR a
//! root-level `applications.md`. If no tier yields a valid root, resolution
//! fails with [`PathError::RepoNotConfigured`].
//!
//! All functions take an explicit base directory so they are unit-testable
//! without touching real process state.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Errors that can arise while resolving the repo root or reading config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathError {
    /// No tier yielded a directory containing `applications.md`.
    RepoNotConfigured,
}

impl std::fmt::Display for PathError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PathError::RepoNotConfigured => write!(
                f,
                "career-ops repo not configured: no data/applications.md or applications.md found"
            ),
        }
    }
}

impl std::error::Error for PathError {}

/// The on-disk shape of the app `config.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppConfig {
    /// Persisted repo root chosen by the user (tier 2).
    #[serde(rename = "careerOpsRoot", skip_serializing_if = "Option::is_none")]
    pub career_ops_root: Option<String>,
}

/// Shared application state holding the resolved repo root.
#[derive(Debug, Clone)]
pub struct AppPaths {
    /// The resolved, validated repo root.
    pub root: PathBuf,
}

impl AppPaths {
    /// Path to `applications.md`, preferring `data/applications.md`, falling
    /// back to the root-level file.
    pub fn applications_md(&self) -> PathBuf {
        applications_md_path(&self.root)
    }

    /// Path to `pipeline.md`, preferring `data/pipeline.md`, falling back to the
    /// root-level file.
    pub fn pipeline_md(&self) -> PathBuf {
        preferred_data_path(&self.root, "pipeline.md")
    }

    /// Path to `scan-history.tsv`, preferring `data/scan-history.tsv`, falling
    /// back to the root-level file.
    pub fn scan_history_tsv(&self) -> PathBuf {
        preferred_data_path(&self.root, "scan-history.tsv")
    }

    /// The `reports/` directory under the repo root.
    pub fn reports_dir(&self) -> PathBuf {
        self.root.join("reports")
    }
}

/// Returns the preferred path for `name` under `root`: `data/<name>` if that
/// file exists, otherwise the root-level `<name>`. The returned path is the one
/// the caller should read; when neither exists it points at the root-level path
/// (so a missing-file read is reported against the more user-visible location).
pub fn preferred_data_path(root: &Path, name: &str) -> PathBuf {
    let nested = root.join("data").join(name);
    if nested.is_file() {
        nested
    } else {
        root.join(name)
    }
}

/// Returns the preferred `applications.md` path under `root`:
/// `data/applications.md` if present, else root-level `applications.md`.
pub fn applications_md_path(root: &Path) -> PathBuf {
    let nested = root.join("data").join("applications.md");
    if nested.is_file() {
        nested
    } else {
        root.join("applications.md")
    }
}

/// True iff `root` looks like a valid career-ops repo (has either
/// `data/applications.md` or a root-level `applications.md`).
pub fn is_valid_root(root: &Path) -> bool {
    root.join("data").join("applications.md").is_file() || root.join("applications.md").is_file()
}

/// The app config directory under `base` (`<base>/career-ops-desktop`).
///
/// `base` is normally the OS config dir (e.g. `~/Library/Application Support`),
/// injected explicitly for testability.
pub fn app_config_dir(base: &Path) -> PathBuf {
    base.join("career-ops-desktop")
}

/// Path to `config.json` inside the app config dir.
pub fn app_config_path(base: &Path) -> PathBuf {
    app_config_dir(base).join("config.json")
}

/// Reads and parses the app `config.json` from the config dir under `base`.
///
/// Returns `Ok(None)` when the file is absent (a non-error: tier 2 is simply
/// skipped). Returns `Ok(Some(_))` on a parseable file; a malformed file is
/// treated as an absent config (skipped) rather than a hard error so a corrupt
/// config never blocks startup.
pub fn read_app_config(base: &Path) -> std::io::Result<Option<AppConfig>> {
    let path = app_config_path(base);
    match std::fs::read_to_string(&path) {
        Ok(contents) => match serde_json::from_str::<AppConfig>(&contents) {
            Ok(cfg) => Ok(Some(cfg)),
            Err(_) => Ok(None),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Resolves the repo root using the 3-tier priority.
///
/// * `env_value`  — the value of `CAREER_OPS_PATH`, if set (tier 1).
/// * `config_base`— base dir under which `config.json` lives (tier 2).
/// * `default_base`— directory against which the default `../career-ops` is
///   resolved (tier 3). Typically the app's working/exe dir.
///
/// Each tier is tried in order; the first tier that yields a *valid* root wins.
/// A configured-but-invalid tier does not short-circuit — resolution falls
/// through to the next tier. If no tier is valid, returns
/// [`PathError::RepoNotConfigured`].
pub fn resolve_repo_root(
    env_value: Option<&str>,
    config_base: &Path,
    default_base: &Path,
) -> Result<PathBuf, PathError> {
    // Tier 1: CAREER_OPS_PATH env.
    if let Some(raw) = env_value {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let candidate = PathBuf::from(trimmed);
            if is_valid_root(&candidate) {
                return Ok(candidate);
            }
        }
    }

    // Tier 2: config.json `careerOpsRoot`. Absent config = tier skipped (not an
    // error). A present-but-invalid root falls through to tier 3.
    if let Ok(Some(cfg)) = read_app_config(config_base) {
        if let Some(root) = cfg.career_ops_root {
            let trimmed = root.trim();
            if !trimmed.is_empty() {
                let candidate = PathBuf::from(trimmed);
                if is_valid_root(&candidate) {
                    return Ok(candidate);
                }
            }
        }
    }

    // Tier 3: default sibling ../career-ops relative to default_base.
    let candidate = default_base.join("..").join("career-ops");
    if is_valid_root(&candidate) {
        return Ok(candidate);
    }

    Err(PathError::RepoNotConfigured)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    /// Create a directory tree that looks like a valid repo (has
    /// `data/applications.md`). Returns the repo root.
    fn make_valid_repo(parent: &Path, name: &str) -> PathBuf {
        let root = parent.join(name);
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(
            root.join("data").join("applications.md"),
            "# Applications Tracker\n",
        )
        .unwrap();
        root
    }

    #[test]
    fn env_tier_wins() {
        let tmp = tempdir().unwrap();
        let env_root = make_valid_repo(tmp.path(), "via-env");
        // A different valid sibling exists at the default location too.
        let app_dir = tmp.path().join("app");
        fs::create_dir_all(&app_dir).unwrap();
        make_valid_repo(tmp.path(), "career-ops"); // default ../career-ops from app_dir

        let resolved = resolve_repo_root(
            Some(env_root.to_str().unwrap()),
            tmp.path(),  // config base (no config.json present)
            &app_dir,    // default base
        )
        .unwrap();

        assert_eq!(resolved, env_root, "env tier must win over default");
    }

    #[test]
    fn missing_file_yields_repo_not_configured() {
        let tmp = tempdir().unwrap();
        // No valid repo anywhere. Default base has no ../career-ops.
        let app_dir = tmp.path().join("app");
        fs::create_dir_all(&app_dir).unwrap();

        let err = resolve_repo_root(None, tmp.path(), &app_dir).unwrap_err();
        assert_eq!(err, PathError::RepoNotConfigured);
    }

    #[test]
    fn valid_sibling_default_tier_ok() {
        let tmp = tempdir().unwrap();
        let app_dir = tmp.path().join("app");
        fs::create_dir_all(&app_dir).unwrap();
        // ../career-ops relative to app_dir == tmp/career-ops
        let expected = make_valid_repo(tmp.path(), "career-ops");

        let resolved = resolve_repo_root(None, tmp.path(), &app_dir).unwrap();

        // The candidate is `app_dir/../career-ops`; compare by canonicalized form.
        assert_eq!(
            resolved.canonicalize().unwrap(),
            expected.canonicalize().unwrap()
        );
    }

    #[test]
    fn config_absent_tier_skipped_not_error() {
        // No env, no config.json present, but a valid default sibling exists.
        // Must succeed via tier 3 (config absence is not an error).
        let tmp = tempdir().unwrap();
        let app_dir = tmp.path().join("app");
        fs::create_dir_all(&app_dir).unwrap();
        make_valid_repo(tmp.path(), "career-ops");

        // config base points at an empty dir (no config.json).
        let resolved = resolve_repo_root(None, &app_dir, &app_dir);
        assert!(
            resolved.is_ok(),
            "absent config.json must be skipped, not an error"
        );
    }

    #[test]
    fn config_tier_resolves_when_present() {
        let tmp = tempdir().unwrap();
        let cfg_root = make_valid_repo(tmp.path(), "via-config");
        // Write config.json under config base.
        let base = tmp.path().join("cfgbase");
        let cfg_dir = app_config_dir(&base);
        fs::create_dir_all(&cfg_dir).unwrap();
        let cfg = AppConfig {
            career_ops_root: Some(cfg_root.to_str().unwrap().to_string()),
        };
        fs::write(
            app_config_path(&base),
            serde_json::to_string(&cfg).unwrap(),
        )
        .unwrap();

        // No env, no default sibling → tier 2 must win.
        let app_dir = tmp.path().join("nope");
        fs::create_dir_all(&app_dir).unwrap();

        let resolved = resolve_repo_root(None, &base, &app_dir).unwrap();
        assert_eq!(resolved, cfg_root);
    }

    #[test]
    fn config_present_but_invalid_falls_through() {
        let tmp = tempdir().unwrap();
        let base = tmp.path().join("cfgbase");
        let cfg_dir = app_config_dir(&base);
        fs::create_dir_all(&cfg_dir).unwrap();
        // config points at a non-repo dir.
        let bogus = tmp.path().join("bogus");
        fs::create_dir_all(&bogus).unwrap();
        let cfg = AppConfig {
            career_ops_root: Some(bogus.to_str().unwrap().to_string()),
        };
        fs::write(
            app_config_path(&base),
            serde_json::to_string(&cfg).unwrap(),
        )
        .unwrap();

        // Valid default sibling exists → tier 3 must catch it.
        let app_dir = tmp.path().join("app");
        fs::create_dir_all(&app_dir).unwrap();
        make_valid_repo(tmp.path(), "career-ops");

        let resolved = resolve_repo_root(None, &base, &app_dir).unwrap();
        assert_eq!(
            resolved.canonicalize().unwrap(),
            tmp.path().join("career-ops").canonicalize().unwrap()
        );
    }

    #[test]
    fn read_app_config_absent_is_none() {
        let tmp = tempdir().unwrap();
        let got = read_app_config(tmp.path()).unwrap();
        assert!(got.is_none());
    }

    #[test]
    fn applications_md_prefers_data_dir() {
        let tmp = tempdir().unwrap();
        let root = make_valid_repo(tmp.path(), "repo");
        assert_eq!(applications_md_path(&root), root.join("data/applications.md"));

        // Root-level fallback when no data/ file.
        let root2 = tmp.path().join("repo2");
        fs::create_dir_all(&root2).unwrap();
        fs::write(root2.join("applications.md"), "x").unwrap();
        assert_eq!(applications_md_path(&root2), root2.join("applications.md"));
    }
}
