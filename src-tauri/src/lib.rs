//! career-ops-desktop backend entry point.
//!
//! Wires the Phase-1 contract seam: repo-root resolution (`paths`), the single
//! allowlisted `dispatch` command surface (`commands`), and the write-isolation
//! module (`writes`). The `dispatch` command and `AppPaths` / `ConfigBase` state
//! are registered with the Tauri runtime here.

pub mod commands;
pub mod paths;
pub mod writes;

use commands::ConfigBase;
use paths::AppPaths;
use std::path::PathBuf;

/// Resolve the repo root at startup, holding it (plus a fallback) in `AppPaths`.
///
/// Resolution uses the 3-tier priority in `paths::resolve_repo_root`. If no tier
/// yields a valid root we still construct an `AppPaths` pointing at the default
/// sibling so the app launches into a `RepoNotConfigured`-style empty state
/// rather than refusing to start; commands then surface `NotFound` until the
/// user picks a valid root via `SaveConfig`.
fn resolve_startup_paths(config_base: &std::path::Path, default_base: &std::path::Path) -> AppPaths {
    let env_value = std::env::var("CAREER_OPS_PATH").ok();
    match paths::resolve_repo_root(env_value.as_deref(), config_base, default_base) {
        Ok(root) => AppPaths { root },
        Err(_) => AppPaths {
            root: default_base.join("..").join("career-ops"),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;

            // Base dir for config.json (OS app-config dir).
            let config_base: PathBuf = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));

            // Default base for the ../career-ops sibling: the executable's dir
            // (bundled) or the current working dir (dev) as a fallback.
            let default_base: PathBuf = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                .or_else(|| std::env::current_dir().ok())
                .unwrap_or_else(|| PathBuf::from("."));

            let app_paths = resolve_startup_paths(&config_base, &default_base);

            app.manage(app_paths);
            app.manage(ConfigBase(config_base));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::dispatch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
