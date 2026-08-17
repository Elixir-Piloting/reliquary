"use client";
import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import {
  getInputType,
  isNumericType,
  isPotentialEnum,
  displayValueToString,
} from "@/components/results-viewer/field-types";

/**
 * Map a Postgres value + dataType to a Glide cell without losing information:
 * - numeric/decimal/money arrive as JSON strings (full precision) — keep as text
 *   so large decimals never render blank or lose precision.
 * - json/jsonb arrive as objects/arrays — render their JSON text form.
 * - arrays arrive as JSON arrays — render their JSON text form.
 * - bytea arrives as "\x<hex>" string — render as-is.
 * - bool -> Glide boolean cell (editable).
 * - enum / unknown -> text (custom editor handled by the grid via editor logic).
 * NULL always renders as empty (Glide shows an empty cell).
 */
export function toGridCell(
  value: unknown,
  dataType: string,
  opts?: { readonly?: boolean }
): GridCell {
  const dt = dataType.toLowerCase();
  const readonly = opts?.readonly ?? false;

  // Boolean -> native Glide boolean cell
  if (dt === "boolean" || dt === "bool") {
    return {
      kind: GridCellKind.Boolean,
      data: toBoolean(value),
      readonly,
      allowOverlay: false,
    };
  }

  // Everything else -> text cell carrying the canonical display string. Keeping
  // objects/arrays as JSON text preserves JSONB/array/bytea/numeric display.
  const display = displayValueToString(value); // "NULL" for null
  const isEmpty = value === null || value === undefined;

  // numeric types: use the number cell for editing, but guard against precision
  // loss by keeping large/string numerics as text (numeric comes back as string).
  if (isNumericType(dt) && typeof value === "number") {
    return {
      kind: GridCellKind.Number,
      displayData: String(value),
      data: value,
      readonly,
      allowOverlay: false,
    };
  }

  return {
    kind: GridCellKind.Text,
    displayData: isEmpty ? "" : display,
    data: isEmpty ? "" : display,
    readonly,
    allowWrapping: true,
    allowOverlay: true,
  };
}

/**
 * Return the initial string to show/editing seed for a cell based on its type.
 */
export function cellEditSeed(value: unknown, dataType: string): string {
  return formatValueForCellInput(value, dataType);
}

function formatValueForCellInput(value: unknown, dataType: string): string {
  const inputType = getInputType(dataType);
  if (value === null || value === undefined) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (inputType === "date") {
    const m = str.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : str;
  }
  if (inputType === "datetime-local") {
    const cleaned = str.replace(" ", "T");
    return cleaned.length > 16 ? cleaned.substring(0, 16) : cleaned;
  }
  return str;
}

export { isNumericType, isPotentialEnum };

/**
 * Interpret a Postgres bool value that may arrive as a real boolean or as the
 * string forms "true"/"false"/"1"/"0"/"t"/"f". Avoids the classic `!!"false"`
 * truthy-string bug that made booleans always render checked.
 */
export function toBoolean(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  const s = String(value).toLowerCase().trim();
  if (s === "true" || s === "1" || s === "t" || s === "yes" || s === "on") return true;
  return false;
}

export function isBooleanType(dataType: string): boolean {
  const dt = dataType.toLowerCase();
  return dt === "boolean" || dt === "bool";
}

/** Whether a column's cells should be editable (true unless readonly). */
export function isEditableColumn(readonly: boolean): boolean {
  return !readonly;
}
