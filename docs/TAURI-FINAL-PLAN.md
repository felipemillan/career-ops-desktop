# Career-Ops Desktop — Final Plan to 100%

**Date:** 2026-06-02
**Repo:** `/Users/admin/Github/jobsOps/career-ops-desktop` (sibling of the fork)
**Source-of-truth for ports/reuse:** `/Users/admin/Github/jobsOps/career-ops` (the fork)
**Prior docs:** `docs/TAURI-DASHBOARD-PLAN.md` (design), `docs/TAURI-BUILD-MASTERPLAN.md` (full 6-phase contract). This doc is the **remaining-work plan** — it supersedes the master plan's sequencing with the current real state + your four explicit asks folded in.

---

## 1. TLDR;

Phases 1 and 2 are done and verified on real data (7 commits, 166 vitest + 39 cargo tests green, tsc/build clean, no HTTP tier, `ipc.ts` sole invoke site); this plan finishes the app in four remaining slices — a quick **open-report button** wiring Applications to the existing report viewer, the **Lane-A/B trigger layer** (script buttons + headless `claude -p` eval, gated by one `env.rs` that resolves the real `claude` binary inside a bundled `.app`), the **embedded terminal** (xterm.js + portable-pty) for interactive Claude/`/career-ops`, and the **write layer** that activates kanban drag-and-drop persistence via the single sanctioned `UpdateStatus` path plus the Firecrawl key-pool — then distribution; everything deterministic is CI-tested, every GUI behavior is gated by a manual smoke check on the built `.app`, and the whole build runs as model-tiered agent fan-outs (opus on Rust/concurrency/security, sonnet on UI, with adversarial verification on high-risk tasks).

---

## 2. Current state (done + verified)

**Phase 1 — read seam:** Tauri v2 + Vite + React 19 + TS scaffold; `paths.rs` 3-tier root resolution + `RepoNotConfigured`; `commands.rs` frozen `dispatch` enum (24 variants); `writes.rs` isolation module + source-grep guard; pure-TS parsers (applications, pipeline, report, scan-history, compute-metrics); `ipc.ts` sole invoke site; `store.ts` refresh bus; golden Rust↔TS type-mirror.

**Phase 2 — viewer:** sidebar nav + `⌘1–5`; Applications (table + read-only kanban toggle); Pipeline; Reports (cards + **slide-in detail viewer** `ReportViewer({reportId,onClose})`); Scan History; Analytics (KPIs, funnel, score dist, weekly activity, status timeline — all pure CSS/SVG). ErrorBoundary per tab + lazy-loaded heavy tabs.

**Verified:** 166 vitest + 39 cargo tests; `tsc --noEmit` clean; `vite build` ok; reads webview→`ipc.ts`→Rust→`std::fs`→parser→UI (Rust does no parsing); caps minimal (`opener` only, zero `shell:allow-execute`).

**Known carry-forwards:** all `dispatch` variants beyond reads/config return `Internal "not implemented"` (handlers land in Phases 3/5). Kanban drag is visual-only (snap-back) until the write layer. `env.rs` not built yet — the load-bearing gate for Lanes B/C.

---

## 3. Your four asks → where they land

| Ask | Phase | Note |
|---|---|---|
| **Open report button per application** | **P2.5** (now, quick) | `CareerApplication.reportPath/reportNumber` already parsed; reuse the existing `ReportViewer`. No backend change. |
| **Terminal to trigger Claude commands** | **P3** (script buttons + headless eval) + **P4** (interactive embedded terminal) | Both: buttons for zero-token scripts + `claude -p`, and a real xterm.js terminal for interactive `/career-ops`. |
| **Activate kanban drag-and-drop** | **P5** (the write layer) | Drag persists via the sanctioned `UpdateStatus` write (`.bak` + `states.yml` validation). The kanban UI already exists; wire `onDragEnd` → write → refresh. |
| **Full analytics** | **P3.5** (polish, independent) | Analytics is built; this slice completes it (status filters, score-vs-time, archetype/portal breakdowns, date-range) and adds live refresh after scans. |

---

## 4. Remaining phases

Model legend: **opus** = hard/novel/security/concurrency; **sonnet** = standard impl/port; **haiku** = mechanical. High-complexity Rust/concurrency tasks get **adversarial verification** (a 2nd opus reviews the diff against acceptance + named risks, must produce a counterexample or sign off).

### Phase 2.5 — Open report from Applications (quick win, no backend)

| id | task | model | files | acceptance | deps |
|---|---|---|---|---|---|
| P2.5-T1 | "View report" affordance on each application | sonnet | `src/tabs/Applications.tsx`, `src/components/reports/ReportViewer.tsx` (reuse), new `src/components/ReportDrawerHost.tsx` | Each table row + kanban card with a non-null `reportPath` shows a 📄 button; click opens `ReportViewer` with `reportId` derived from `reportPath` (strip `reports/` + `.md`). Rows without a report show no button. Esc/backdrop closes. | — |
| P2.5-T2 | Cross-tab "open report" event | sonnet | `src/lib/store.ts` (add an `openReport(id)` bus topic) or local host state | Opening a report from Applications renders the same viewer used in the Reports tab (single component, no duplication). | P2.5-T1 |

**Exit:** click any application with a report → its full report (markdown, score breakdown, legitimacy, Apply URL) opens. `tsc`+tests green. **[GUI-MANUAL]** verify on a real app row.

### Phase 3 — Lane A buttons + Lane B eval (trigger layer) + `env.rs`

The load-bearing gate. `env.rs` must resolve the **real** `claude` (`~/.local/bin/claude`) inside a **bundled `.app`**, not just `tauri dev`.

| id | task | model | files | acceptance | deps |
|---|---|---|---|---|---|
| P3-T1 | `env.rs` — one canonical hydration module | **opus** | `src-tauri/src/env.rs`, `lib.rs` | Runs `<$SHELL> -lic 'env'` (sentinel-fenced, 30s timeout) once at startup; captures `PATH` + `ANTHROPIC_*`/`CLAUDE_*` + `FIRECRAWL_*`; injects into every child spawn. Acceptance test **resolves the `claude` binary via the hydrated PATH** (not a hardcoded allowlist). `claude` missing → `AuthMissing` with a user message. | — |
| P3-T2 | `sidecar.rs` — async spawn, line-stream, job registry, process-group cancel, kill-all-on-quit | **opus** | `src-tauri/src/sidecar.rs`, `lib.rs` | `spawn_job(program,args,cwd)→job_id`; `job://stdout|stderr|exit` events; own process group; `cancel_job` kills group <500ms, no orphans; `RunExit` on app quit kills all. Program+args only, never `sh -c`. cargo test: echo streams + exits; cancel leaves no orphan. | P3-T1 |
| P3-T3 | Lane A script handlers | sonnet | `src-tauri/src/commands.rs` | Implement `run_scan{dry_run,company}` (**cwd = repo root**, scan is cwd-driven), `run_merge`, `run_dedup`, `run_patterns`, `run_followup`, `run_verify_pipeline`, `gen_pdf{app_number}`, `gen_latex{app_number}`. PDF/LaTeX: glob the **input** (`output/cv-{num}-*.html`/`*.tex`, newest mtime) and **derive** the output path — never glob the not-yet-existing output. | P3-T2 |
| P3-T4 | Lane B `evaluate_url{url}` (headless) | sonnet | `src-tauri/src/commands.rs` | Spawns `claude -p "/career-ops oferta <url>"` via `env.rs`; streams output; result flagged "unconfirmed (batch mode)". URL validated before spawn. | P3-T1,P3-T2 |
| P3-T5 | Console panel + action bar UI | sonnet | `src/components/ConsolePanel.tsx`, `src/components/ActionBar.tsx`, `src/lib/jobs.ts` (event subscription via Tauri events) | Buttons for each Lane-A script + an "Evaluate URL" input; streams stdout/stderr live; cancel button; native notification on completion; grid refresh on relevant job exit (`emitRefresh`). Token-spend hint on LLM actions. | P3-T3,P3-T4 |
| P3-T6 | `FileExists{glob}` handler + PDF button reconciliation | sonnet | `src-tauri/src/commands.rs`, `src/tabs/Applications.tsx` | PDF/LaTeX buttons key off real file presence, not the stale ✅ emoji. | P3-T3 |
| P3-T7 | cargo + vitest + smoke | sonnet | tests + `docs/PHASE-3-SMOKE.md` | spawn/cancel/no-orphan cargo tests; jobs event-bus vitest; **[GUI-MANUAL]** run scan from a button, watch stream, see grid refresh + notification. | all P3 |

**Risk gate (R1):** P3-T1 acceptance **must** run in `tauri build` output, not `tauri dev` — prove `claude` resolves authenticated in the bundled `.app`. If it can't, Lanes B/C re-scope here.

### Phase 3.5 — Full analytics (independent, can run parallel with P3)

| id | task | model | files | acceptance |
|---|---|---|---|---|
| P3.5-T1 | Complete analytics | sonnet | `src/tabs/AnalyticsTab.tsx`, `src/components/analytics/*` | Add: status-filter chips, score-vs-time trend, portal/archetype breakdown, date-range selector, conversion rates per funnel stage. All from `compute-metrics` over the store; zero-division safe; empty-repo safe. |
| P3.5-T2 | Live refresh | sonnet | analytics hooks | Analytics re-computes on `emitRefresh('applications')` after a scan/eval (P3-T5). **[GUI-MANUAL]** run scan → analytics updates. |

### Phase 4 — Embedded terminal (interactive Claude)

| id | task | model | files | acceptance | deps |
|---|---|---|---|---|---|
| P4-T1 | PTY host | **opus** | `src-tauri/src/pty.rs`, `Cargo.toml` (`portable-pty`), `lib.rs` | `pty_open/write/resize/kill` commands + `pty://data`/`pty://exit` events; raw bytes **base64-framed** over the JSON bus; spawns `$SHELL` with the hydrated env (reuse `env.rs`). cargo test: byte round-trip incl. control/non-UTF-8. | P3-T1 |
| P4-T2 | xterm.js terminal tab | sonnet | `src/tabs/TerminalTab.tsx`, `package.json` (`@xterm/xterm`, `@xterm/addon-fit`) | Terminal renders, input works, resize → SIGWINCH, Ctrl-C, exit handled; enable the Terminal nav item (remove disabled flag in `lib/tabs.ts`). | P4-T1 |
| P4-T3 | Convenience launchers | sonnet | `TerminalTab.tsx` | Buttons to seed common commands (`/career-ops`, `claude`, a scan) into the PTY. | P4-T2 |
| P4-T4 | smoke | sonnet | `docs/PHASE-4-SMOKE.md` | **[GUI-MANUAL]** run interactive `claude` / `/career-ops` inside the tab end-to-end; resize + Ctrl-C work; no orphan PTY on quit. | P4-T3 |

### Phase 5 — Write layer (activates kanban drag-and-drop)

| id | task | model | files | acceptance | deps |
|---|---|---|---|---|---|
| P5-T1 | Validators | **opus** | `src-tauri/src/validate.rs` | URL allowlist (http/https), `app_number` bounds, `CanonicalStatus` against `states.yml` (8 states), report-id regex. Security choke point for all writes. cargo tested. | — |
| P5-T2 | `UpdateStatus{app_number,status,notes?}` write | **opus** | `src-tauri/src/writes.rs`, `commands.rs` | In `writes.rs` ONLY: locate the one `applications.md` row by number, edit status (+optional notes) **preserving the row format**, validate status via P5-T1, write `.bak` first, atomic temp+rename. Never add a row, never rewrite the whole file. Guard test still green. cargo test on a real-format fixture: one row changes, others byte-identical, `.bak` created. | P5-T1 |
| P5-T3 | **Kanban drag-and-drop persist** | sonnet | `src/components/kanban/ApplicationsKanban.tsx`, `src/tabs/Applications.tsx` | Remove the read-only/snap-back; `onDragEnd` → `updateStatus(app_number, newColumnStatus)` via `ipc.ts` → on success `emitRefresh('applications')` so the board + table re-read. Optimistic move with rollback on error. Drag between the 8 status columns persists to `applications.md`. | P5-T2 |
| P5-T4 | `QueueUrl{url}` write | sonnet | `src-tauri/src/writes.rs` | Atomic append to `pipeline.md`, dedup (reuse the fork's `queue-server.mjs` insert logic), never duplicate. Wire a "queue URL" action in the UI. | P5-T1 |
| P5-T5 | `firecrawl-pool` (TS) | **opus** | `src/lib/firecrawl-pool.ts`, `src-tauri` key storage | 1..N keys, work queue, per-key concurrency cap + cooldown on 429, least-loaded parallel distribution, dormant at 0 keys. Extends the fork's `_firecrawl-utils.mjs`. | P5-T1 |
| P5-T6 | Firecrawl UI | sonnet | `src/components/firecrawl/*` | Add/remove keys; live status (keys / cooling-down / queue / rate); opt-in "Scrape long-tail" action; keys stored via `writes.rs` to `.env.firecrawl` (gitignored). | P5-T5 |
| P5-T7 | tests + smoke | sonnet | tests + `docs/PHASE-5-SMOKE.md` | write-isolation guard green; UpdateStatus fixture test; **[GUI-MANUAL]** drag a card → reopen the file → status changed + `.bak` exists; 429 cools one key, others keep working. | all P5 |

**Safety:** every write goes through `writes.rs`, `.bak` first, atomic, validated. The kanban write touches your real `applications.md` — P5-T2's fixture test (one row changes, rest byte-identical) must pass before P5-T3 ships.

### Phase 6 — Distribution

| id | task | model | files | acceptance |
|---|---|---|---|---|
| P6-T1 | App icon + metadata | haiku | `src-tauri/icons/*`, `tauri.conf.json` | Real icon, product name, version. |
| P6-T2 | `tauri build` → `.dmg` | sonnet | — | Build succeeds; `.dmg` launches; ad-hoc/unsigned (`xattr -dr com.apple.quarantine` note in README). |
| P6-T3 | Full smoke on the built `.app` | sonnet | `docs/RELEASE-SMOKE.md` | **[GUI-MANUAL]** every gate below passes on a fresh `.dmg` build (not `tauri dev`). |

---

## 5. Sequencing & critical path

```
P2.5 (open report — do now, independent)
        │
   ┌────┴─────────── P3.5 (full analytics — parallel, independent)
   │
P3-T1 env.rs ──► P3-T2 sidecar ──► P3-T3/4 handlers ──► P3-T5 console UI ──► P3 smoke
   │                                                          (R1 gate: claude in bundled .app)
   └──► P4-T1 PTY ──► P4-T2 terminal ──► P4 smoke
   
P5-T1 validate ──► P5-T2 UpdateStatus ──► P5-T3 KANBAN DnD persist ──► P5 smoke
                   └► P5-T4 QueueUrl   └► P5-T5/6 firecrawl-pool
                   
P6 (icon ► build ► release smoke) — last
```

**Load-bearing:** `env.rs` (P3-T1) — Lanes B/C and the terminal all depend on it; prove it in a bundled `.app` before building on it. `validate.rs` (P5-T1) gates every write. `UpdateStatus` (P5-T2) must pass its byte-identical fixture test before the kanban write (P5-T3) touches real data.

**Suggested order by your interest + dependency:** P2.5 (open report) → P5-T1/T2/T3 (kanban DnD — high interest, self-contained write path) → P3 (env.rs + buttons + eval) → P4 (terminal) → P3.5 (full analytics) → P5-T4/5/6 (queue + firecrawl) → P6.

---

## 6. Definition of 100% working

The app is done when all hold (★ = your explicit asks):

1. Reads: all 5 tabs render live; ★ **clicking an application opens its report** detail.
2. ★ **Kanban drag-and-drop persists** status to `applications.md` (`.bak` + validated + atomic; never adds/rewrites rows).
3. ★ **Terminal** runs interactive `claude`/`/career-ops` inside the app (input/resize/Ctrl-C/exit), and **Lane-A buttons + headless eval** trigger Claude/script commands with streamed output.
4. ★ **Full analytics**: all charts + filters + date range, live-refresh after scans, zero NaN on empty.
5. `claude` auth + `node`/`claude` PATH work in the **built `.app`** (gate #8, proven in `tauri build`).
6. Writes only via `writes.rs` (source-grep guard green); the UI never adds a row or rewrites the tracker.
7. `cargo test` + `vitest run` green in CI; `tauri build` → launchable `.dmg`.
8. The release smoke checklist passes on a fresh `.app`.
9. Go TUI `dashboard/` kept; old `dashboard-web` retired.

---

## 7. Execution model

Fan out per phase with model-matched agents in fresh contexts; orchestrator (me) scaffolds shared seams (nav, IPC contract) and verifies + commits each slice:
- **opus** — `env.rs`, `sidecar.rs`, `pty.rs`, `validate.rs`, `UpdateStatus`, `firecrawl-pool` (concurrency/security/write-isolation), each with adversarial verification.
- **sonnet** — UI (console, terminal tab, firecrawl UI, kanban wiring, analytics, open-report), Lane-A handlers, ports.
- **haiku** — icons, mechanical config.
- Disjoint file ownership for parallel agents; shared files (App.tsx, ipc.ts, commands.rs enum) edited only by the orchestrator or a single owner. Each agent self-verifies (cargo/vitest); orchestrator runs the integration build + GUI gates with you.
