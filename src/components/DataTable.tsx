/**
 * DataTable.tsx — Reusable TanStack Table wrapper.
 * Plain Vite + React 19. No Next.js. No 'use client'.
 */
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  defaultSorting?: SortingState;
}

export function DataTable<TData>({
  columns,
  data,
  defaultSorting = [],
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="w-full overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
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
                      "px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap select-none",
                      canSort ? "cursor-pointer hover:text-gray-900 dark:hover:text-white" : "",
                    ].join(" ")}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                  >
                    {header.isPlaceholder ? null : (
                      <span className="inline-flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className="text-gray-400 text-xs">
                            {sortDir === "asc" ? "▲" : sortDir === "desc" ? "▼" : "⇅"}
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
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-3 py-2 text-gray-700 dark:text-gray-200 whitespace-nowrap"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-gray-400 dark:text-gray-500"
              >
                No results.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
