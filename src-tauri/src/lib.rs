//! career-ops-desktop backend entry point.
//!
//! Wires the Phase-1 contract seam: repo-root resolution (`paths`), the single
//! allowlisted `dispatch` command surface (`commands`), and the write-isolation
//! module (`writes`). The `dispatch` command and `AppPaths` / `ConfigBase` state
//! are registered with the Tauri runtime here.

pub mod commands;
pub mod env;
pub mod paths;
pub mod pty;
pub mod sidecar;
pub mod validate;
pub mod writes;

use commands::ConfigBase;
use paths::AppPaths;
use pty::PtyRegistry;
use sidecar::JobRegistry;
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
        .plugin(tauri_plugin_dialog::init())
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
            // The async job engine's registry (P3-T2). Held in managed state so
            // `dispatch` (cancel_job) and the exit hook can reach it.
            app.manage(JobRegistry::new());
            // The PTY (embedded terminal) registry (P4-T1). Held in managed state
            // so the pty_* commands and the exit hook can reach it.
            app.manage(PtyRegistry::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::dispatch,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .on_window_event(|window, event| {
            // App-exit hook: when the last window is destroyed, kill every live
            // job AND every live PTY so no spawned child / terminal outlives the
            // GUI (no orphans).
            if let tauri::WindowEvent::Destroyed = event {
                use tauri::Manager;
                let app = window.app_handle();
                if let Some(registry) = app.try_state::<JobRegistry>() {
                    registry.kill_all();
                }
                if let Some(pty_registry) = app.try_state::<PtyRegistry>() {
                    pty_registry.kill_all();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
