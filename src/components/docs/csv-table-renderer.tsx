"use client";

import { AlertTriangle, Table2 } from "lucide-react";
import type { ParsedBmadFile } from "@/lib/bmad/types";

type CsvData = NonNullable<ParsedBmadFile["csv"]>;

export function CsvTableRenderer({ csv }: { csv: CsvData }) {
  const [header, ...bodyRows] = csv.rows;
  const columnIndexes = Array.from(
    { length: csv.columnCount },
    (_, index) => index,
  );
  const hasHeader = header && header.some((cell) => cell.trim().length > 0);

  if (csv.rows.length === 0 || csv.columnCount === 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-sm text-muted-foreground">
        <Table2 className="size-8 opacity-40" />
        <p>This CSV file is empty.</p>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-3">
      {(csv.truncated || csv.parseErrors.length > 0) && (
        <div
          className="rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-sm"
          role="alert"
        >
          <div className="flex items-center gap-2 font-medium text-warning-foreground">
            <AlertTriangle className="size-4 shrink-0" />
            CSV preview notice
          </div>
          {csv.truncated && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing the first {csv.rows.length.toLocaleString()} of{" "}
              {csv.totalRows.toLocaleString()} rows.
            </p>
          )}
          {csv.parseErrors.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {csv.parseErrors.slice(0, 3).map((error, index) => (
                <li key={`${error}-${index}`}>{error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border">
        <div className="w-full min-w-0 max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            {hasHeader && (
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  <th className="w-12 border-b border-r px-3 py-2 text-xs font-medium text-muted-foreground">
                    #
                  </th>
                  {columnIndexes.map((columnIndex) => (
                    <th
                      key={columnIndex}
                      className="min-w-32 border-b border-r px-3 py-2 font-medium"
                    >
                      {header[columnIndex] || `Column ${columnIndex + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {(hasHeader ? bodyRows : csv.rows).map((row, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-muted/30">
                  <th className="w-12 border-b border-r px-3 py-2 text-xs font-medium text-muted-foreground">
                    {hasHeader ? rowIndex + 2 : rowIndex + 1}
                  </th>
                  {columnIndexes.map((columnIndex) => (
                    <td
                      key={columnIndex}
                      className="min-w-32 max-w-80 whitespace-pre-wrap break-words border-b border-r px-3 py-2 align-top"
                    >
                      {row[columnIndex] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
