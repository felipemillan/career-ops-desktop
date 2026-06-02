//! Write/security validators (P5-T1).
//!
//! The single choke point that every write path (`UpdateStatus`, `QueueUrl`,
//! and any future mutating command) routes its untrusted inputs through before
//! touching disk. Each validator is pure, dependency-free, and returns a typed
//! [`CommandError`] with [`ErrorCode::InvalidArg`] on rejection so the failure
//! surfaces identically to the frontend regardless of which input was bad.
//!
//! Design notes:
//! - No `regex` crate (not a dependency); the report-id matcher is hand-rolled
//!   against `^\d{3}-[a-z0-9-]+-\d{4}-\d{2}-\d{2}$`.
//! - URL scheme matching is case-insensitive and only `http`/`https` pass; this
//!   rejects `javascript:`, `file:`, `ftp:`, `data:`, the empty string, and any
//!   value without a recognizable scheme.
//! - Status validation maps the incoming string to the closed
//!   [`CanonicalStatus`] enum using the exact 8 `states.yml` labels. Matching is
//!   exact and case-sensitive: free-text and lowercased values are rejected so
//!   the tracker `status` cell can only ever hold a canonical label.

use crate::commands::{CanonicalStatus, CommandError, ErrorCode};

/// Inclusive upper bound for `app_number`. Tracker rows are sequential 3-digit
/// numbers in practice; this is a generous sanity ceiling, not a real limit.
const APP_NUMBER_MAX: u32 = 100_000;

/// Build an `InvalidArg` error with the given message.
fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::new(ErrorCode::InvalidArg, message)
}

/// Validate a URL destined for a write (e.g. `QueueUrl`) or a headless eval.
///
/// Only the `http` and `https` schemes are allowed. Everything else — other
/// schemes (`javascript:`, `file:`, `ftp:`, `data:`, `mailto:`, …), an empty
/// string, or garbage with no scheme — is rejected with [`ErrorCode::InvalidArg`].
///
/// The scheme is matched case-insensitively (`HTTP://` is fine) and a `//`
/// authority separator is required, which is what an actual web URL always has
/// and what `javascript:alert(1)` lacks.
pub fn validate_url(url: &str) -> Result<(), CommandError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(invalid("url is empty"));
    }

    // Split on the first ':' to isolate the scheme.
    let Some((scheme, rest)) = trimmed.split_once(':') else {
        return Err(invalid(format!("url has no scheme: {url:?}")));
    };

    let scheme_lc = scheme.to_ascii_lowercase();
    if scheme_lc != "http" && scheme_lc != "https" {
        return Err(invalid(format!(
            "url scheme not allowed (only http/https): {url:?}"
        )));
    }

    // Require the `//` authority marker and a non-empty host after it. This
    // rejects `http:` / `https:` with no authority and keeps us to real web URLs.
    let Some(authority) = rest.strip_prefix("//") else {
        return Err(invalid(format!("url missing authority: {url:?}")));
    };
    // Host ends at the first '/', '?', or '#'.
    let host_end = authority
        .find(['/', '?', '#'])
        .unwrap_or(authority.len());
    if authority[..host_end].is_empty() {
        return Err(invalid(format!("url has empty host: {url:?}")));
    }

    Ok(())
}

/// Validate an application/tracker row number.
///
/// Must be within `1..=100_000`. Zero and out-of-range values are rejected with
/// [`ErrorCode::InvalidArg`].
pub fn validate_app_number(app_number: u32) -> Result<(), CommandError> {
    if app_number == 0 {
        return Err(invalid("app_number must be >= 1 (got 0)"));
    }
    if app_number > APP_NUMBER_MAX {
        return Err(invalid(format!(
            "app_number out of range (1..={APP_NUMBER_MAX}): {app_number}"
        )));
    }
    Ok(())
}

/// Validate a status string against the 8 canonical `states.yml` labels and map
/// it to the [`CanonicalStatus`] enum.
///
/// Matching is exact (case-sensitive) against the labels `Evaluated`, `Applied`,
/// `Responded`, `Interview`, `Offer`, `Rejected`, `Discarded`, `SKIP`.
/// Free-text, lowercased, or aliased values are rejected with
/// [`ErrorCode::InvalidArg`] — the writer must hold the canonical label.
pub fn validate_status(status: &str) -> Result<CanonicalStatus, CommandError> {
    match status {
        "Evaluated" => Ok(CanonicalStatus::Evaluated),
        "Applied" => Ok(CanonicalStatus::Applied),
        "Responded" => Ok(CanonicalStatus::Responded),
        "Interview" => Ok(CanonicalStatus::Interview),
        "Offer" => Ok(CanonicalStatus::Offer),
        "Rejected" => Ok(CanonicalStatus::Rejected),
        "Discarded" => Ok(CanonicalStatus::Discarded),
        "SKIP" => Ok(CanonicalStatus::Skip),
        other => Err(invalid(format!("not a canonical status: {other:?}"))),
    }
}

/// Validate an eval model token against `^[a-z0-9][a-z0-9.\-]{2,40}$`.
///
/// A sane CLI `--model` token: starts with a lowercase letter or digit, then 2
/// to 40 more chars from `[a-z0-9.-]` (total length 3..=41). This rejects empty
/// strings, uppercase, whitespace, slashes, and shell metacharacters so the
/// value can be forwarded as a `--model` argv element safely. On success the
/// trimmed token is returned. Rejection → [`ErrorCode::InvalidArg`].
pub fn validate_eval_model(model: &str) -> Result<String, CommandError> {
    let trimmed = model.trim();
    let bytes = trimmed.as_bytes();
    // Total length: leading char + 2..=40 more = 3..=41.
    if bytes.len() < 3 || bytes.len() > 41 {
        return Err(invalid(format!(
            "model has an implausible length (3..=41): {model:?}"
        )));
    }
    let first = bytes[0];
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return Err(invalid(format!(
            "model must start with a lowercase letter or digit: {model:?}"
        )));
    }
    let rest_ok = bytes[1..]
        .iter()
        .all(|&b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-');
    if !rest_ok {
        return Err(invalid(format!(
            "model contains disallowed characters (allowed: a-z 0-9 . -): {model:?}"
        )));
    }
    Ok(trimmed.to_string())
}

/// Validate a report id against `^\d{3}-[a-z0-9-]+-\d{4}-\d{2}-\d{2}$`.
///
/// Hand-rolled (no `regex` dependency). The id is `{ddd}-{slug}-{YYYY}-{MM}-{DD}`
/// where the slug is one or more `[a-z0-9-]` characters. Rejection →
/// [`ErrorCode::InvalidArg`]. This is shape-only; path containment for report
/// reads is enforced separately in `commands.rs`.
pub fn validate_report_id(id: &str) -> Result<(), CommandError> {
    if matches_report_id(id) {
        Ok(())
    } else {
        Err(invalid(format!("invalid report id: {id:?}")))
    }
}

/// Pure predicate for the report-id pattern. Kept separate so the boolean form
/// is unit-testable without constructing a `CommandError`.
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

#[cfg(test)]
mod tests {
    use super::*;

    // ---- validate_url ----

    #[test]
    fn url_accepts_http_and_https() {
        assert!(validate_url("http://example.com").is_ok());
        assert!(validate_url("https://example.com/jobs/123?ref=x#top").is_ok());
        assert!(validate_url("HTTPS://Example.com").is_ok());
        // Leading/trailing whitespace is tolerated.
        assert!(validate_url("  https://example.com  ").is_ok());
    }

    #[test]
    fn url_rejects_javascript_scheme() {
        let err = validate_url("javascript:alert(1)").unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidArg);
    }

    #[test]
    fn url_rejects_other_schemes_and_garbage() {
        for bad in [
            "",
            "   ",
            "file:///etc/passwd",
            "ftp://example.com",
            "data:text/html,<script>",
            "mailto:a@b.com",
            "not a url",
            "://no-scheme.com",
            "http:",
            "https://",
            "http:///path-only",
        ] {
            let err = validate_url(bad).unwrap_err();
            assert_eq!(err.code, ErrorCode::InvalidArg, "expected reject for {bad:?}");
        }
    }

    // ---- validate_app_number ----

    #[test]
    fn app_number_accepts_in_range() {
        assert!(validate_app_number(1).is_ok());
        assert!(validate_app_number(468).is_ok());
        assert!(validate_app_number(100_000).is_ok());
    }

    #[test]
    fn app_number_rejects_zero() {
        let err = validate_app_number(0).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidArg);
    }

    #[test]
    fn app_number_rejects_out_of_range() {
        let err = validate_app_number(100_001).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidArg);
    }

    // ---- validate_status ----

    #[test]
    fn status_maps_all_eight_labels() {
        assert_eq!(validate_status("Evaluated").unwrap(), CanonicalStatus::Evaluated);
        assert_eq!(validate_status("Applied").unwrap(), CanonicalStatus::Applied);
        assert_eq!(validate_status("Responded").unwrap(), CanonicalStatus::Responded);
        assert_eq!(validate_status("Interview").unwrap(), CanonicalStatus::Interview);
        assert_eq!(validate_status("Offer").unwrap(), CanonicalStatus::Offer);
        assert_eq!(validate_status("Rejected").unwrap(), CanonicalStatus::Rejected);
        assert_eq!(validate_status("Discarded").unwrap(), CanonicalStatus::Discarded);
        assert_eq!(validate_status("SKIP").unwrap(), CanonicalStatus::Skip);
    }

    #[test]
    fn status_label_roundtrips() {
        for s in [
            CanonicalStatus::Evaluated,
            CanonicalStatus::Applied,
            CanonicalStatus::Responded,
            CanonicalStatus::Interview,
            CanonicalStatus::Offer,
            CanonicalStatus::Rejected,
            CanonicalStatus::Discarded,
            CanonicalStatus::Skip,
        ] {
            assert_eq!(validate_status(s.label()).unwrap(), s);
        }
    }

    #[test]
    fn status_rejects_free_text_and_case_variants() {
        for bad in ["evaluated", "applied", "skip", "Skip", "", "Done", "In Review", "rejected "] {
            let err = validate_status(bad).unwrap_err();
            assert_eq!(err.code, ErrorCode::InvalidArg, "expected reject for {bad:?}");
        }
    }

    // ---- validate_eval_model ----

    #[test]
    fn eval_model_accepts_sane_tokens() {
        for ok in [
            "claude-sonnet-4-6",
            "claude-opus-4-8",
            "gpt-4.1",
            "haiku",
            "gpt5",
            "claude-3-5-sonnet-20241022",
        ] {
            assert!(validate_eval_model(ok).is_ok(), "should accept {ok:?}");
        }
        // Trimming is applied.
        assert_eq!(
            validate_eval_model("  claude-sonnet-4-6  ").unwrap(),
            "claude-sonnet-4-6"
        );
    }

    #[test]
    fn eval_model_rejects_junk() {
        let too_long = "a".repeat(42);
        for bad in [
            "",
            "  ",
            "ab",              // too short (2)
            "-leading-hyphen", // starts with hyphen
            ".leading-dot",    // starts with dot
            "Claude-Sonnet",   // uppercase
            "claude sonnet",   // space
            "claude/sonnet",   // slash
            "claude;rm -rf",   // metachars
            "model$(whoami)",  // command substitution
            too_long.as_str(), // too long (>41)
        ] {
            let err = validate_eval_model(bad).unwrap_err();
            assert_eq!(err.code, ErrorCode::InvalidArg, "expected reject for {bad:?}");
        }
    }

    // ---- validate_report_id ----

    #[test]
    fn report_id_accepts_valid() {
        assert!(validate_report_id("001-acme-2026-01-01").is_ok());
        assert!(validate_report_id("468-multi-word-slug-2026-12-31").is_ok());
        assert!(validate_report_id("042-a-2026-06-02").is_ok());
    }

    #[test]
    fn report_id_rejects_bad() {
        for bad in [
            "01-acme-2026-01-01",     // 2-digit number
            "0001-acme-2026-01-01",   // 4-digit number
            "001-Acme-2026-01-01",    // uppercase slug
            "001--2026-01-01",        // empty slug
            "001-acme-2026-1-1",      // non-padded date
            "../../etc/passwd",       // traversal
            "001-acme-2026-01",       // missing day
            "abc-acme-2026-01-01",    // non-digit number
            "",
        ] {
            let err = validate_report_id(bad).unwrap_err();
            assert_eq!(err.code, ErrorCode::InvalidArg, "expected reject for {bad:?}");
        }
    }
}
