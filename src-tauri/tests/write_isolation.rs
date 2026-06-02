//! Write-isolation guard (P1-T4b).
//!
//! Greps every `src/**/*.rs` file and asserts that no filesystem *mutation*
//! against a tracker / config target (`fs::write`, `fs::rename`,
//! `OpenOptions::…append`, `fs::copy`) appears OUTSIDE `writes.rs`. This freezes
//! the invariant: the only module permitted to write tracker files,
//! `config.json`, or `.env.firecrawl` is `writes.rs`.
//!
//! The guard is intentionally simple and conservative: it flags the presence of
//! any mutating-write API call in a non-`writes.rs` source file. To
//! demonstrate it can fail, temporarily add e.g.
//! `std::fs::write("applications.md", "x").unwrap();` to `paths.rs` and re-run —
//! the test goes red; remove it and it returns green.

use std::fs;
use std::path::{Path, PathBuf};

/// Substrings that indicate a filesystem mutation. Any occurrence outside
/// `writes.rs` (in non-test, non-comment code) fails the guard.
const FORBIDDEN_WRITE_PATTERNS: &[&str] = &[
    "fs::write",
    "fs::rename",
    "fs::copy",
    ".append(true)",
    "OpenOptions",
];

/// Files exempt from the guard (the sanctioned write module).
const ALLOWED_FILES: &[&str] = &["writes.rs"];

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            out.push(path);
        }
    }
}

/// Strip `#[cfg(test)]` modules and line comments so test helpers (which may
/// legitimately call `fs::write` to set up fixtures) and doc comments don't trip
/// the guard. This is a coarse but sufficient filter: it drops everything from a
/// `mod tests` marker to end-of-file, and strips `//`-comment tails.
fn strip_tests_and_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        // Stop scanning once we hit the test module — fixtures live there.
        let trimmed = line.trim_start();
        if trimmed.starts_with("#[cfg(test)]") || trimmed.starts_with("mod tests") {
            break;
        }
        // Drop line-comment tails (handles doc comments and `//` notes).
        let code = match line.find("//") {
            Some(idx) => &line[..idx],
            None => line,
        };
        out.push_str(code);
        out.push('\n');
    }
    out
}

#[test]
fn no_writes_outside_writes_module() {
    let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    collect_rs_files(&src_dir, &mut files);
    assert!(!files.is_empty(), "expected to find src/*.rs files to scan");

    let mut violations = Vec::new();

    for file in &files {
        let name = file
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if ALLOWED_FILES.contains(&name) {
            continue;
        }

        let raw = fs::read_to_string(file).unwrap_or_default();
        let code = strip_tests_and_comments(&raw);

        for pat in FORBIDDEN_WRITE_PATTERNS {
            if code.contains(pat) {
                violations.push(format!(
                    "{}: forbidden write pattern `{}` found outside writes.rs",
                    file.display(),
                    pat
                ));
            }
        }
    }

    assert!(
        violations.is_empty(),
        "write-isolation guard failed:\n{}",
        violations.join("\n")
    );
}
