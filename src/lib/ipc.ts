/**
 * ipc.ts — THE ONLY module in this app that imports invoke from @tauri-apps/api/core.
 * All IPC goes through here. Mirror of the frozen Rust wire contract.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type CanonicalStatus =
  | 'Evaluated'
  | 'Applied'
  | 'Responded'
  | 'Interview'
  | 'Offer'
  | 'Rejected'
  | 'Discarded'
  | 'SKIP';

export type FirecrawlStatusDto = {
  keys: number;
  cooling_down: number;
  queue_len: number;
  dormant: boolean;
};

export type ReportMeta = {
  id: string;
  filename: string;
};

// ---------------------------------------------------------------------------
// Command discriminated union (internally tagged, snake_case cmd values)
// ---------------------------------------------------------------------------

export type Cmd =
  | { cmd: 'read_applications' }
  | { cmd: 'get_config' }
  | { cmd: 'save_config'; root: string }
  | { cmd: 'file_exists'; glob: string }
  | { cmd: 'read_pipeline' }
  | { cmd: 'read_scan_history' }
  | { cmd: 'list_reports' }
  | { cmd: 'read_report'; id: string }
  | ({ cmd: 'run_scan'; dry_run: boolean } & { company?: string })
  | { cmd: 'run_merge' }
  | { cmd: 'run_dedup' }
  | { cmd: 'run_patterns' }
  | { cmd: 'run_followup' }
  | { cmd: 'run_verify_pipeline' }
  | { cmd: 'gen_pdf'; app_number: number }
  | { cmd: 'gen_latex'; app_number: number }
  | { cmd: 'cancel_job'; job_id: string }
  | { cmd: 'evaluate_url'; url: string }
  | { cmd: 'firecrawl_add_key'; key: string }
  | { cmd: 'firecrawl_remove_key'; index: number }
  | { cmd: 'firecrawl_status' }
  | { cmd: 'firecrawl_enqueue'; urls: string[] }
  | { cmd: 'queue_url'; url: string }
  | ({ cmd: 'update_status'; app_number: number; status: CanonicalStatus } & { notes?: string });

// ---------------------------------------------------------------------------
// CommandResponse (externally tagged, snake_case kind values)
// ---------------------------------------------------------------------------

export type CommandResponse =
  | { kind: 'text'; content: string }
  | { kind: 'config'; root: string; firecrawl: FirecrawlStatusDto }
  | { kind: 'reports'; items: ReportMeta[] }
  | { kind: 'job_started'; job_id: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'firecrawl_status'; status: FirecrawlStatusDto }
  | { kind: 'write_ok'; duplicate: boolean };

// ---------------------------------------------------------------------------
// CommandError
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'not_found'
  | 'invalid_arg'
  | 'repo_not_configured'
  | 'spawn_failed'
  | 'auth_missing'
  | 'write_rejected'
  | 'internal';

export type CommandError = {
  code: ErrorCode;
  message: string;
};

// ---------------------------------------------------------------------------
// Core dispatcher — private
// ---------------------------------------------------------------------------

async function dispatch<T extends CommandResponse>(command: Cmd): Promise<T> {
  return invoke<T>('dispatch', { command });
}

// ---------------------------------------------------------------------------
// Per-variant wrappers
// ---------------------------------------------------------------------------

// -- Phase-1 core --

export function readApplications(): Promise<Extract<CommandResponse, { kind: 'text' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'text' }>>({ cmd: 'read_applications' });
}

export function getConfig(): Promise<Extract<CommandResponse, { kind: 'config' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'config' }>>({ cmd: 'get_config' });
}

export function saveConfig(root: string): Promise<Extract<CommandResponse, { kind: 'write_ok' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'write_ok' }>>({ cmd: 'save_config', root });
}

// -- File / data reads --

export function fileExists(glob: string): Promise<Extract<CommandResponse, { kind: 'bool' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'bool' }>>({ cmd: 'file_exists', glob });
}

export function readPipeline(): Promise<Extract<CommandResponse, { kind: 'text' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'text' }>>({ cmd: 'read_pipeline' });
}

export function readScanHistory(): Promise<Extract<CommandResponse, { kind: 'text' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'text' }>>({ cmd: 'read_scan_history' });
}

export function listReports(): Promise<Extract<CommandResponse, { kind: 'reports' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'reports' }>>({ cmd: 'list_reports' });
}

export function readReport(id: string): Promise<Extract<CommandResponse, { kind: 'text' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'text' }>>({ cmd: 'read_report', id });
}

// -- Job runners --

export function runScan(opts: {
  dryRun?: boolean;
  company?: string;
}): Promise<Extract<CommandResponse, { kind: 'job_started' }>> {
  const cmd: Cmd = opts.company !== undefined
    ? { cmd: 'run_scan', dry_run: opts.dryRun ?? false, company: opts.company }
    : { cmd: 'run_scan', dry_run: opts.dryRun ?? false };
  return dispatch<Extract<CommandResponse, { kind: 'job_started' }>>(cmd);
}

export function runMerge(): Promise<Extract<CommandResponse, { kind: 'job_started' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'job_started' }>>({ cmd: 'run_merge' });
}

export function runDedup(): Promise<Extract<CommandResponse, { kind: 'job_started' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'job_started' }>>({ cmd: 'run_dedup' });
}

export function runPatterns(): Promise<Extract<CommandResponse, { kind: 'job_started' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'job_started' }>>({ cmd: 'run_patterns' });
}

export function runFollowup(): Promise<Extract<CommandResponse, { kind: 'job_started' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'job_started' }>>({ cmd: 'run_followup' });
}

export function runVerifyPipeline(): Promise<Extract<CommandResponse, { kind: 'job_started' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'job_started' }>>({ cmd: 'run_verify_pipeline' });
}

// -- PDF / LaTeX generation --

export function genPdf(appNumber: number): Promise<Extract<CommandResponse, { kind: 'job_started' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'job_started' }>>({ cmd: 'gen_pdf', app_number: appNumber });
}

export function genLatex(appNumber: number): Promise<Extract<CommandResponse, { kind: 'job_started' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'job_started' }>>({ cmd: 'gen_latex', app_number: appNumber });
}

// -- Job control --

export function cancelJob(jobId: string): Promise<Extract<CommandResponse, { kind: 'write_ok' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'write_ok' }>>({ cmd: 'cancel_job', job_id: jobId });
}

// -- Evaluation --

export function evaluateUrl(url: string): Promise<Extract<CommandResponse, { kind: 'job_started' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'job_started' }>>({ cmd: 'evaluate_url', url });
}

// -- Firecrawl --

export function firecrawlAddKey(key: string): Promise<Extract<CommandResponse, { kind: 'write_ok' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'write_ok' }>>({ cmd: 'firecrawl_add_key', key });
}

export function firecrawlRemoveKey(index: number): Promise<Extract<CommandResponse, { kind: 'write_ok' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'write_ok' }>>({ cmd: 'firecrawl_remove_key', index });
}

export function firecrawlStatus(): Promise<Extract<CommandResponse, { kind: 'firecrawl_status' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'firecrawl_status' }>>({ cmd: 'firecrawl_status' });
}

export function firecrawlEnqueue(urls: string[]): Promise<Extract<CommandResponse, { kind: 'write_ok' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'write_ok' }>>({ cmd: 'firecrawl_enqueue', urls });
}

// -- Queue --

export function queueUrl(url: string): Promise<Extract<CommandResponse, { kind: 'write_ok' }>> {
  return dispatch<Extract<CommandResponse, { kind: 'write_ok' }>>({ cmd: 'queue_url', url });
}

// -- Status update --

export function updateStatus(
  appNumber: number,
  status: CanonicalStatus,
  notes?: string,
): Promise<Extract<CommandResponse, { kind: 'write_ok' }>> {
  const cmd: Cmd = notes !== undefined
    ? { cmd: 'update_status', app_number: appNumber, status, notes }
    : { cmd: 'update_status', app_number: appNumber, status };
  return dispatch<Extract<CommandResponse, { kind: 'write_ok' }>>(cmd);
}

// ---------------------------------------------------------------------------
// PTY commands — direct invoke (NOT via dispatch), Phase 4
// ---------------------------------------------------------------------------

/** Opens a new PTY with the given dimensions. Returns a ptyId (e.g. "pty-1"). */
export function openPty(cols: number, rows: number): Promise<string> {
  return invoke<string>('pty_open', { cols, rows });
}

/**
 * Writes raw bytes to the PTY. `dataBase64` must be base64-encoded bytes
 * (NOT a unicode string passed through btoa — use TextEncoder + bytesToBase64).
 */
export function writePty(ptyId: string, dataBase64: string): Promise<void> {
  return invoke<void>('pty_write', { ptyId, data: dataBase64 });
}

/** Resizes the PTY to new cols/rows (call after FitAddon.fit()). */
export function resizePty(ptyId: string, cols: number, rows: number): Promise<void> {
  return invoke<void>('pty_resize', { ptyId, cols, rows });
}

/** Kills the PTY process (call on component unmount). */
export function killPty(ptyId: string): Promise<void> {
  return invoke<void>('pty_kill', { ptyId });
}

// ---------------------------------------------------------------------------
// PTY event helpers — subscribe to backend events, Phase 4
// ---------------------------------------------------------------------------

type PtyDataPayload = { ptyId: string; data: string };
type PtyExitPayload = { ptyId: string; code: number | null };

/**
 * Subscribe to `pty://data` events.
 * The callback receives the ptyId and a Uint8Array of raw output bytes
 * (the base64 payload is decoded internally).
 */
export function onPtyData(
  cb: (ptyId: string, bytes: Uint8Array) => void,
): Promise<UnlistenFn> {
  return listen<PtyDataPayload>('pty://data', (event) => {
    const { ptyId, data } = event.payload;
    cb(ptyId, base64ToBytes(data));
  });
}

/**
 * Subscribe to `pty://exit` events.
 * The callback receives the ptyId and the exit code (null if signaled).
 */
export function onPtyExit(
  cb: (ptyId: string, code: number | null) => void,
): Promise<UnlistenFn> {
  return listen<PtyExitPayload>('pty://exit', (event) => {
    const { ptyId, code } = event.payload;
    cb(ptyId, code);
  });
}

// ---------------------------------------------------------------------------
// Base64 helpers — binary-safe, used internally and exported for TerminalTab
// ---------------------------------------------------------------------------

/**
 * Encode a Uint8Array to a base64 string.
 * Safe for arbitrary binary data (avoids the btoa+charCodeAt trick which
 * breaks on multi-byte UTF-8 since we operate on raw bytes, not code points).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode a base64 string to a Uint8Array.
 * Mirrors bytesToBase64.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
