import { toCsv } from "./csv";

/** Triggers a browser download of CSV rows. */
export function downloadCsv(rows: unknown[][], filename: string): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
