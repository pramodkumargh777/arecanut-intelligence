/** Spreadsheet formula prefixes are neutralized so downloaded source text cannot execute as a formula. */
export function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const text = /^[=+\-@\t\r]/.test(raw) && !/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
