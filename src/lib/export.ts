export interface ExportColumn {
  name: string;
  dataType: string;
}

export interface ExportResult {
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
}

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function quoteIfNeeded(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Serialize a query result to CSV (RFC 4180 quoting).
 * - Header row = column names.
 * - null/undefined render as an empty field.
 * - Fields containing a comma, double quote, CR or LF are wrapped in double
 *   quotes; embedded quotes are doubled.
 * - Rows are joined with `\n` (LF) for simplicity.
 */
export function toCsv(result: ExportResult): string {
  const header = result.columns.map(c => quoteIfNeeded(c.name)).join(",");
  const lines = result.rows.map(row =>
    result.columns.map(col => quoteIfNeeded(csvField(row[col.name]))).join(",")
  );
  return [header, ...lines].join("\n");
}

/**
 * Serialize a query result to JSON as a pretty-printed array of row objects.
 * (The standard "export as JSON" shape; column metadata is recoverable from
 * the keys of the first object, so we keep the payload minimal.)
 */
export function toJson(result: ExportResult): string {
  return JSON.stringify(result.rows, null, 2);
}

/**
 * Trigger a browser download of `content` as `filename`. Uses the standard
 * Blob + anchor-click path; in the Tauri webview this downloads to the
 * default download location (no plugin/dialog involved).
 */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
