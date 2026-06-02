/**
 * TerminalTab — Phase 4 embedded terminal.
 * Wires xterm.js to the Rust PTY backend via ipc.ts helpers.
 * No 'use client' — this is a Vite/Tauri app, not Next.js.
 */
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  openPty,
  writePty,
  resizePty,
  killPty,
  onPtyData,
  onPtyExit,
  bytesToBase64,
} from '../lib/ipc';

// ---------------------------------------------------------------------------
// Toolbar launcher buttons
// ---------------------------------------------------------------------------

interface LauncherButton {
  label: string;
  /** Raw text written into the PTY (including newline to execute). */
  payload: string;
}

// Buttons seed real shell commands (the terminal runs in the career-ops repo).
// Note: `/career-ops` is a Claude Code slash command — run `claude` first, then
// type it inside the Claude session (so it's not a standalone button here).
const LAUNCHERS: LauncherButton[] = [
  { label: 'claude', payload: 'claude\n' },
  { label: 'scan', payload: 'node scan.mjs\n' },
  { label: 'clear', payload: 'clear\n' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeToBase64(text: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return bytesToBase64(bytes);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TerminalTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exited, setExited] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Build terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Cascadia Code", "Fira Mono", "JetBrains Mono", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Store refs immediately so cleanup can reach them
    termRef.current = term;
    fitRef.current = fitAddon;

    // Fit after a short tick to let the DOM settle
    const fitAndOpen = async () => {
      fitAddon.fit();
      const { cols, rows } = term;

      let ptyId: string;
      try {
        ptyId = await openPty(cols, rows);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to open PTY: ${msg}`);
        term.dispose();
        return;
      }

      ptyIdRef.current = ptyId;

      // Route PTY output → xterm
      const unlistenData = await onPtyData((id, bytes) => {
        if (id === ptyId) {
          termRef.current?.write(bytes);
        }
      });

      // Handle PTY exit
      const unlistenExit = await onPtyExit((id, code) => {
        if (id === ptyId) {
          termRef.current?.writeln(`\r\n[process exited${code !== null ? ` with code ${code}` : ''}]`);
          setExited(true);
        }
      });

      // Route xterm input → PTY
      const onDataDispose = term.onData((data) => {
        const pty = ptyIdRef.current;
        if (!pty) return;
        writePty(pty, encodeToBase64(data)).catch((_e) => {
          // PTY may have closed; ignore write errors after exit
        });
      });

      // ResizeObserver for container size changes
      const ro = new ResizeObserver(() => {
        const fa = fitRef.current;
        const t = termRef.current;
        const pid = ptyIdRef.current;
        if (!fa || !t || !pid) return;
        fa.fit();
        resizePty(pid, t.cols, t.rows).catch(() => {
          // ignore if PTY already exited
        });
      });
      ro.observe(container);

      // Cleanup closure
      return () => {
        ro.disconnect();
        onDataDispose.dispose();
        unlistenData();
        unlistenExit();
        const pid = ptyIdRef.current;
        if (pid) {
          killPty(pid).catch(() => {
            // best-effort
          });
          ptyIdRef.current = null;
        }
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    };

    // Run async init, store cleanup fn
    let cleanup: (() => void) | undefined;
    fitAndOpen().then((fn) => {
      cleanup = fn;
    });

    return () => {
      // If init completed, run the cleanup returned by fitAndOpen
      if (cleanup) {
        cleanup();
      } else {
        // Init still in flight — dispose what we have so far
        const pid = ptyIdRef.current;
        if (pid) {
          killPty(pid).catch(() => {});
          ptyIdRef.current = null;
        }
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLaunch = (payload: string) => {
    const ptyId = ptyIdRef.current;
    if (!ptyId) return;
    writePty(ptyId, encodeToBase64(payload)).catch(() => {});
  };

  // Error state — PTY could not be opened (e.g. shell missing in sandbox)
  if (error) {
    return (
      <div className="flex flex-col h-full bg-[#0d1117] text-gray-300 p-6 gap-3">
        <p className="text-red-400 font-mono text-sm">Terminal error</p>
        <p className="font-mono text-xs text-gray-500">{error}</p>
        <p className="text-xs text-gray-600">
          Make sure the shell is available and the Rust PTY backend is running.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117]" style={{ minHeight: 0 }}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#161b22] border-b border-[#30363d] shrink-0">
        <span className="text-xs text-gray-500 mr-1">Launch:</span>
        {LAUNCHERS.map((btn) => (
          <button
            key={btn.label}
            onClick={() => handleLaunch(btn.payload)}
            className="px-2 py-0.5 rounded text-xs font-mono bg-[#21262d] text-[#79c0ff] hover:bg-[#30363d] border border-[#30363d] transition-colors"
          >
            {btn.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-600 italic">
          {exited ? 'Process exited — click a button to relaunch or type a new command' : 'Type commands or use the buttons above'}
        </span>
      </div>

      {/* xterm container — fills remaining height */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
