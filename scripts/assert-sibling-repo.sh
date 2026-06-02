#!/usr/bin/env bash
# P1-T1 guard: this MUST be its own repo, not nested in career-ops/
set -euo pipefail
top="$(git rev-parse --show-toplevel)"
base="$(basename "$top")"
if [ "$base" != "career-ops-desktop" ]; then
  echo "FAIL: git toplevel is '$base', expected 'career-ops-desktop' (are you nested inside career-ops/?)" >&2
  exit 1
fi
echo "OK: standalone repo at $top"
