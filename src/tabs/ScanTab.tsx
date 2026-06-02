/**
 * ScanTab.tsx — Scan history viewer with TanStack Table.
 *
 * Data flow: useScanHistory() → readScanHistory() (ipc) → parseScanHistory() (parser)
 * Features:
 *   - TanStack Table (@tanstack/react-table) with sorting
 *   - Text search over company + title
 *   - Portal dropdown filter
 *   - ~50 rows/page pagination
 *   - Row click opens URL via @tauri-apps/plugin-opener openUrl()
 *   - Missing tsv → empty state
 *
 * No direct invoke. No node:fs. No 'use client'.
 */

import { useState, useMemo } from 'react';
import {
  type ColumnDef,
  type SortingState,
  type PaginationState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useScanHistory } from '../hooks/useScanHistory';
import type { ScanHistoryRow } from '../lib/parsers/scan-history';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  added: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  skipped_location: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  skipped_title: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  duplicate: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  seen: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

function StatusBadge({ status }: { status: string }) {
  const colorClass =
    STATUS_COLORS[status] ??
    'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  return (
    <span
      className={[
        'inline-block px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap',
        colorClass,
      ].join(' ')}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const columns: ColumnDef<ScanHistoryRow, unknown>[] = [
  {
    accessorKey: 'num',
    header: '#',
    enableSorting: true,
    size: 52,
    cell: (info) => (
      <span className="font-mono text-gray-400 dark:text-gray-500 text-xs">
        {String(info.getValue<number>()).padStart(3, '0')}
      </span>
    ),
  },
  {
    accessorKey: 'first_seen',
    header: 'First Seen',
    enableSorting: true,
    size: 100,
    cell: (info) => (
      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {info.getValue<string>()}
      </span>
    ),
  },
  {
    accessorKey: 'portal',
    header: 'Portal',
    enableSorting: true,
    size: 90,
    cell: (info) => (
      <span className="text-xs text-gray-600 dark:text-gray-300 capitalize">
        {info.getValue<string>()}
      </span>
    ),
  },
  {
    accessorKey: 'company',
    header: 'Company',
    enableSorting: true,
    size: 140,
    cell: (info) => (
      <span className="font-medium text-gray-900 dark:text-white text-sm">
        {info.getValue<string>()}
      </span>
    ),
  },
  {
    accessorKey: 'title',
    header: 'Title',
    enableSorting: true,
    cell: (info) => (
      <span
        className="block max-w-xs truncate text-sm text-gray-700 dark:text-gray-200"
        title={info.getValue<string>()}
      >
        {info.getValue<string>()}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    enableSorting: true,
    size: 130,
    cell: (info) => <StatusBadge status={info.getValue<string>()} />,
  },
  {
    accessorKey: 'location',
    header: 'Location',
    enableSorting: false,
    size: 180,
    cell: (info) => {
      const loc = info.getValue<string>();
      return loc ? (
        <span
          className="block max-w-[180px] truncate text-xs text-gray-500 dark:text-gray-400"
          title={loc}
        >
          {loc}
        </span>
      ) : (
        <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="flex items-center justify-center py-24" role="status" aria-label="Loading">
      <div className="flex flex-col items-center gap-3 text-gray-400 dark:text-gray-500">
        <svg
          className="animate-spin h-8 w-8"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <span className="text-sm">Loading scan history…</span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="flex flex-col items-center gap-3 text-center max-w-sm">
        <span className="text-4xl">🔍</span>
        <h3 className="text-gray-700 dark:text-gray-200 font-semibold">No scan history yet</h3>
        <p className="text-gray-400 dark:text-gray-500 text-sm">
          Run a portal scan to populate{' '}
          <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">
            data/scan-history.tsv
          </code>
          .
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function ScanTab() {
  const { rows, loading, error, refresh } = useScanHistory();

  const [search, setSearch] = useState('');
  const [portalFilter, setPortalFilter] = useState<string>('all');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'num', desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });

  // Derive unique portal list from data
  const portals = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.portal) set.add(row.portal);
    }
    return Array.from(set).sort();
  }, [rows]);

  // Client-side filtering: search + portal
  const filtered = useMemo<ScanHistoryRow[]>(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        !q ||
        row.company.toLowerCase().includes(q) ||
        row.title.toLowerCase().includes(q);
      const matchesPortal =
        portalFilter === 'all' || row.portal === portalFilter;
      return matchesSearch && matchesPortal;
    });
  }, [rows, search, portalFilter]);

  // Reset to page 0 when filters change
  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  };
  const handlePortalChange = (val: string) => {
    setPortalFilter(val);
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  };

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualFiltering: true, // we filter ourselves above
  });

  // -------------------------------------------------------------------------
  // Render states
  // -------------------------------------------------------------------------

  if (loading && rows.length === 0) {
    return <Spinner />;
  }

  if (error !== null && rows.length === 0) {
    if (error.includes('not_found')) {
      return <EmptyState />;
    }
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-2 text-center max-w-sm">
          <span className="text-3xl">⚠️</span>
          <p className="text-red-600 dark:text-red-400 text-sm font-medium">
            Failed to load scan history
          </p>
          <p className="text-gray-500 dark:text-gray-400 text-xs break-all">{error}</p>
        </div>
      </div>
    );
  }

  if (!loading && rows.length === 0) {
    return <EmptyState />;
  }

  // -------------------------------------------------------------------------
  // Loaded
  // -------------------------------------------------------------------------

  const pageCount = table.getPageCount();
  const currentPage = table.getState().pagination.pageIndex;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Search */}
          <input
            type="search"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search company or title…"
            className="w-52 shrink min-w-0 px-2.5 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          {/* Portal filter */}
          <select
            value={portalFilter}
            onChange={(e) => handlePortalChange(e.target.value)}
            className="px-2.5 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 shrink-0"
            aria-label="Filter by portal"
          >
            <option value="all">All portals</option>
            {portals.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {/* Stats + refresh */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">
            {filtered.length.toLocaleString()} / {rows.length.toLocaleString()} rows
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40 transition-colors whitespace-nowrap"
            title="Refresh scan history"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="w-full overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 flex-1">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      className={[
                        'px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap select-none',
                        canSort
                          ? 'cursor-pointer hover:text-gray-900 dark:hover:text-white'
                          : '',
                      ].join(' ')}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      {header.isPlaceholder ? null : (
                        <span className="inline-flex items-center gap-1">
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {canSort && (
                            <span className="text-gray-400 text-xs">
                              {sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : '⇅'}
                            </span>
                          )}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => {
                const url = row.original.url;
                return (
                  <tr
                    key={row.id}
                    onClick={() => {
                      if (url) openUrl(url);
                    }}
                    className={[
                      'bg-white dark:bg-gray-900 transition-colors',
                      url
                        ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/30'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800',
                    ].join(' ')}
                    title={url ? `Open: ${url}` : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-3 py-2 text-gray-700 dark:text-gray-200"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-gray-400 dark:text-gray-500"
                >
                  No results match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>
            Page {currentPage + 1} of {pageCount}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              aria-label="First page"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              aria-label="Previous page"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              aria-label="Next page"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => table.setPageIndex(pageCount - 1)}
              disabled={!table.getCanNextPage()}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              aria-label="Last page"
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
