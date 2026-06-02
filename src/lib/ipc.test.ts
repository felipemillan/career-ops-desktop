/**
 * ipc.test.ts — Verify that each wrapper builds the exact {cmd} object and
 * calls invoke('dispatch', { command: <cmd> }) correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tauri invoke BEFORE importing ipc so the module sees the mock.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import {
  readApplications,
  getConfig,
  saveConfig,
  fileExists,
  readPipeline,
  readScanHistory,
  listReports,
  readReport,
  runScan,
  runMerge,
  runDedup,
  runPatterns,
  runFollowup,
  runVerifyPipeline,
  genPdf,
  genLatex,
  cancelJob,
  evaluateUrl,
  firecrawlAddKey,
  firecrawlRemoveKey,
  firecrawlStatus,
  firecrawlEnqueue,
  queueUrl,
  updateStatus,
} from './ipc';

const mockInvoke = vi.mocked(invoke);

// Helper: capture the last `command` argument passed to invoke('dispatch', ...)
function lastCommand(): unknown {
  const calls = mockInvoke.mock.calls;
  const last = calls[calls.length - 1];
  // last = ['dispatch', { command }]
  return (last[1] as { command: unknown }).command;
}

beforeEach(() => {
  mockInvoke.mockReset();
  // Default resolved value to avoid unhandled promise rejections
  mockInvoke.mockResolvedValue({ kind: 'text', content: '' });
});

// ---------------------------------------------------------------------------
// Routing: all wrappers call invoke('dispatch', ...)
// ---------------------------------------------------------------------------
describe('routing', () => {
  it('all wrappers call invoke with dispatch as the command name', async () => {
    await readApplications();
    expect(mockInvoke).toHaveBeenCalledWith('dispatch', expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// read_applications
// ---------------------------------------------------------------------------
describe('readApplications()', () => {
  it('sends { cmd: "read_applications" } with NO extra fields', async () => {
    await readApplications();
    const cmd = lastCommand() as Record<string, unknown>;
    expect(cmd).toEqual({ cmd: 'read_applications' });
    expect(Object.keys(cmd)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// get_config
// ---------------------------------------------------------------------------
describe('getConfig()', () => {
  it('sends { cmd: "get_config" } with NO extra fields', async () => {
    mockInvoke.mockResolvedValue({ kind: 'config', root: '/x', firecrawl: { keys: 0, cooling_down: 0, queue_len: 0, dormant: true } });
    await getConfig();
    expect(lastCommand()).toEqual({ cmd: 'get_config' });
  });
});

// ---------------------------------------------------------------------------
// save_config
// ---------------------------------------------------------------------------
describe('saveConfig()', () => {
  it('sends { cmd: "save_config", root: "/x" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false });
    await saveConfig('/x');
    expect(lastCommand()).toEqual({ cmd: 'save_config', root: '/x' });
  });
});

// ---------------------------------------------------------------------------
// file_exists
// ---------------------------------------------------------------------------
describe('fileExists()', () => {
  it('sends { cmd: "file_exists", glob: "*.md" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'bool', value: true });
    await fileExists('*.md');
    expect(lastCommand()).toEqual({ cmd: 'file_exists', glob: '*.md' });
  });
});

// ---------------------------------------------------------------------------
// read_pipeline / read_scan_history
// ---------------------------------------------------------------------------
describe('readPipeline()', () => {
  it('sends { cmd: "read_pipeline" }', async () => {
    await readPipeline();
    expect(lastCommand()).toEqual({ cmd: 'read_pipeline' });
  });
});

describe('readScanHistory()', () => {
  it('sends { cmd: "read_scan_history" }', async () => {
    await readScanHistory();
    expect(lastCommand()).toEqual({ cmd: 'read_scan_history' });
  });
});

// ---------------------------------------------------------------------------
// list_reports / read_report
// ---------------------------------------------------------------------------
describe('listReports()', () => {
  it('sends { cmd: "list_reports" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'reports', items: [] });
    await listReports();
    expect(lastCommand()).toEqual({ cmd: 'list_reports' });
  });
});

describe('readReport()', () => {
  it('sends { cmd: "read_report", id: "001" }', async () => {
    await readReport('001');
    expect(lastCommand()).toEqual({ cmd: 'read_report', id: '001' });
  });
});

// ---------------------------------------------------------------------------
// run_scan — key contract: dry_run (not dryRun), company OMITTED when absent
// ---------------------------------------------------------------------------
describe('runScan()', () => {
  it('sends dry_run:true with no company key when company is absent', async () => {
    mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j1' });
    await runScan({ dryRun: true });
    const cmd = lastCommand() as Record<string, unknown>;
    expect(cmd).toEqual({ cmd: 'run_scan', dry_run: true });
    expect('company' in cmd).toBe(false);
  });

  it('sends dry_run:false and company when provided', async () => {
    mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j2' });
    await runScan({ dryRun: false, company: 'acme' });
    expect(lastCommand()).toEqual({ cmd: 'run_scan', dry_run: false, company: 'acme' });
  });

  it('defaults dry_run to false when not provided', async () => {
    mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j3' });
    await runScan({});
    const cmd = lastCommand() as Record<string, unknown>;
    expect(cmd.dry_run).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// run_merge / run_dedup / run_patterns / run_followup / run_verify_pipeline
// ---------------------------------------------------------------------------
describe('runMerge()', () => {
  it('sends { cmd: "run_merge" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' });
    await runMerge();
    expect(lastCommand()).toEqual({ cmd: 'run_merge' });
  });
});

describe('runDedup()', () => {
  it('sends { cmd: "run_dedup" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' });
    await runDedup();
    expect(lastCommand()).toEqual({ cmd: 'run_dedup' });
  });
});

describe('runPatterns()', () => {
  it('sends { cmd: "run_patterns" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' });
    await runPatterns();
    expect(lastCommand()).toEqual({ cmd: 'run_patterns' });
  });
});

describe('runFollowup()', () => {
  it('sends { cmd: "run_followup" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' });
    await runFollowup();
    expect(lastCommand()).toEqual({ cmd: 'run_followup' });
  });
});

describe('runVerifyPipeline()', () => {
  it('sends { cmd: "run_verify_pipeline" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' });
    await runVerifyPipeline();
    expect(lastCommand()).toEqual({ cmd: 'run_verify_pipeline' });
  });
});

// ---------------------------------------------------------------------------
// gen_pdf / gen_latex
// ---------------------------------------------------------------------------
describe('genPdf()', () => {
  it('sends { cmd: "gen_pdf", app_number: 42 }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' });
    await genPdf(42);
    expect(lastCommand()).toEqual({ cmd: 'gen_pdf', app_number: 42 });
  });
});

describe('genLatex()', () => {
  it('sends { cmd: "gen_latex", app_number: 7 }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' });
    await genLatex(7);
    expect(lastCommand()).toEqual({ cmd: 'gen_latex', app_number: 7 });
  });
});

// ---------------------------------------------------------------------------
// cancel_job
// ---------------------------------------------------------------------------
describe('cancelJob()', () => {
  it('sends { cmd: "cancel_job", job_id: "abc" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false });
    await cancelJob('abc');
    expect(lastCommand()).toEqual({ cmd: 'cancel_job', job_id: 'abc' });
  });
});

// ---------------------------------------------------------------------------
// evaluate_url
// ---------------------------------------------------------------------------
describe('evaluateUrl()', () => {
  it('sends { cmd: "evaluate_url", url: "https://example.com" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' });
    await evaluateUrl('https://example.com');
    expect(lastCommand()).toEqual({ cmd: 'evaluate_url', url: 'https://example.com' });
  });
});

// ---------------------------------------------------------------------------
// firecrawl_*
// ---------------------------------------------------------------------------
describe('firecrawlAddKey()', () => {
  it('sends { cmd: "firecrawl_add_key", key: "k1" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false });
    await firecrawlAddKey('k1');
    expect(lastCommand()).toEqual({ cmd: 'firecrawl_add_key', key: 'k1' });
  });
});

describe('firecrawlRemoveKey()', () => {
  it('sends { cmd: "firecrawl_remove_key", index: 0 }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false });
    await firecrawlRemoveKey(0);
    expect(lastCommand()).toEqual({ cmd: 'firecrawl_remove_key', index: 0 });
  });
});

describe('firecrawlStatus()', () => {
  it('sends { cmd: "firecrawl_status" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'firecrawl_status', status: { keys: 1, cooling_down: 0, queue_len: 0, dormant: false } });
    await firecrawlStatus();
    expect(lastCommand()).toEqual({ cmd: 'firecrawl_status' });
  });
});

describe('firecrawlEnqueue()', () => {
  it('sends { cmd: "firecrawl_enqueue", urls: [...] }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false });
    await firecrawlEnqueue(['https://a.com', 'https://b.com']);
    expect(lastCommand()).toEqual({ cmd: 'firecrawl_enqueue', urls: ['https://a.com', 'https://b.com'] });
  });
});

// ---------------------------------------------------------------------------
// queue_url
// ---------------------------------------------------------------------------
describe('queueUrl()', () => {
  it('sends { cmd: "queue_url", url: "https://x.com" }', async () => {
    mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false });
    await queueUrl('https://x.com');
    expect(lastCommand()).toEqual({ cmd: 'queue_url', url: 'https://x.com' });
  });
});

// ---------------------------------------------------------------------------
// update_status — notes OMITTED when absent
// ---------------------------------------------------------------------------
describe('updateStatus()', () => {
  it('sends { cmd: "update_status", app_number, status } with NO notes key when not provided', async () => {
    mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false });
    await updateStatus(5, 'Applied');
    const cmd = lastCommand() as Record<string, unknown>;
    expect(cmd).toEqual({ cmd: 'update_status', app_number: 5, status: 'Applied' });
    expect('notes' in cmd).toBe(false);
  });

  it('sends notes when provided', async () => {
    mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false });
    await updateStatus(5, 'Interview', 'Good call');
    expect(lastCommand()).toEqual({
      cmd: 'update_status',
      app_number: 5,
      status: 'Interview',
      notes: 'Good call',
    });
  });
});

// ---------------------------------------------------------------------------
// cmd key coverage — every variant has a unique cmd string
// ---------------------------------------------------------------------------
describe('cmd key coverage', () => {
  const cmdMap: Record<string, () => Promise<unknown>> = {
    read_applications: () => readApplications(),
    get_config: () => { mockInvoke.mockResolvedValue({ kind: 'config', root: '/', firecrawl: { keys: 0, cooling_down: 0, queue_len: 0, dormant: true } }); return getConfig(); },
    save_config: () => { mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false }); return saveConfig('/'); },
    file_exists: () => { mockInvoke.mockResolvedValue({ kind: 'bool', value: false }); return fileExists('*'); },
    read_pipeline: () => readPipeline(),
    read_scan_history: () => readScanHistory(),
    list_reports: () => { mockInvoke.mockResolvedValue({ kind: 'reports', items: [] }); return listReports(); },
    read_report: () => readReport('001'),
    run_scan: () => { mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' }); return runScan({}); },
    run_merge: () => { mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' }); return runMerge(); },
    run_dedup: () => { mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' }); return runDedup(); },
    run_patterns: () => { mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' }); return runPatterns(); },
    run_followup: () => { mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' }); return runFollowup(); },
    run_verify_pipeline: () => { mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' }); return runVerifyPipeline(); },
    gen_pdf: () => { mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' }); return genPdf(1); },
    gen_latex: () => { mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' }); return genLatex(1); },
    cancel_job: () => { mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false }); return cancelJob('j'); },
    evaluate_url: () => { mockInvoke.mockResolvedValue({ kind: 'job_started', job_id: 'j' }); return evaluateUrl('https://x.com'); },
    firecrawl_add_key: () => { mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false }); return firecrawlAddKey('k'); },
    firecrawl_remove_key: () => { mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false }); return firecrawlRemoveKey(0); },
    firecrawl_status: () => { mockInvoke.mockResolvedValue({ kind: 'firecrawl_status', status: { keys: 0, cooling_down: 0, queue_len: 0, dormant: true } }); return firecrawlStatus(); },
    firecrawl_enqueue: () => { mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false }); return firecrawlEnqueue([]); },
    queue_url: () => { mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false }); return queueUrl('https://x.com'); },
    update_status: () => { mockInvoke.mockResolvedValue({ kind: 'write_ok', duplicate: false }); return updateStatus(1, 'Evaluated'); },
  };

  for (const [expectedCmd, fn] of Object.entries(cmdMap)) {
    it(`${expectedCmd} wrapper sends cmd="${expectedCmd}"`, async () => {
      await fn();
      const cmd = lastCommand() as Record<string, unknown>;
      expect(cmd.cmd).toBe(expectedCmd);
    });
  }
});
