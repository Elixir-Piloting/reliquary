"use client";
import { GridCellKind, type EditableGridCell } from "@glideapps/glide-data-grid";
import { toSqlParamValue, isPotentialEnum } from "@/components/results-viewer/field-types";
import type { PendingChange } from "@/components/results-viewer/types";

export type EditOp = "update" | "insert" | "delete";

export interface EditStatement {
  query: string;
  params: unknown[];
}

export interface CellEditInput {
  schema: string;
  table: string;
  row: Record<string, unknown>;
  columnName: string;
  dataType: string;
  pkColumns: string[];
  newValue: string; // canonical string form the user entered
}

/**
 * Build the parameterized UPDATE statement (and metadata) for a single cell edit.
 * Uses `$1` for the new value and `$2..` for PK values — never string-built SQL.
 */
export function buildUpdateChange(input: CellEditInput): PendingChange | null {
  const { schema, table, row, columnName, dataType, pkColumns, newValue } = input;
  const pkValues = getPkValues(row, pkColumns);
  if (Object.keys(pkValues).length === 0) return null; // no PK -> can't update

  // Skip no-op edits: if the new value equals the cell's current value, don't
  // stage a change (prevents staging identical values on click/blur).
  const current = row[columnName] == null ? "" : String(row[columnName]);
  if (newValue === current) return null;

  const pkEntries = Object.entries(pkValues);
  const whereClause = pkEntries.map(([k], i) => `"${k}" = $${i + 2}`).join(" AND ");
  return {
    id: `${schema}.${table}.${columnName}-${Date.now()}`,
    schema,
    table,
    op: "update",
    columnName,
    dataType,
    pkValues,
    originalValue: row[columnName],
    newValue,
    statement: {
      query: `UPDATE "${schema}"."${table}" SET "${columnName}" = $1 WHERE ${whereClause}`,
      params: [toSqlParamValue(newValue, dataType), ...pkEntries.map(([, v]) => v)],
    },
  };
}

/**
 * Build the parameterized INSERT statement + values for a new row.
 * Identity columns are excluded (auto-generated).
 */
export function buildInsertChange(input: {
  schema: string;
  table: string;
  values: Record<string, string>; // column -> raw input string
  columns: { columnName: string; dataType: string; isIdentity?: boolean }[];
}): PendingChange {
  const { schema, table, values, columns } = input;
  const insertable = columns.filter(c => !c.isIdentity);
  const filled = insertable.filter(c => (values[c.columnName] ?? "") !== "");

  let query: string;
  let params: unknown[];
  const typedValues: Record<string, unknown> = {};

  if (filled.length === 0) {
    query = `INSERT INTO "${schema}"."${table}" DEFAULT VALUES`;
    params = [];
  } else {
    const cols = filled.map(c => `"${c.columnName}"`).join(", ");
    const placeholders = filled.map((_, i) => `$${i + 1}`).join(", ");
    query = `INSERT INTO "${schema}"."${table}" (${cols}) VALUES (${placeholders})`;
    params = filled.map(c => toSqlParamValue(values[c.columnName] ?? "", c.dataType));
  }
  for (const c of filled) typedValues[c.columnName] = toSqlParamValue(values[c.columnName] ?? "", c.dataType);

  return {
    id: `insert-${schema}.${table}-${Date.now()}`,
    schema,
    table,
    op: "insert",
    columnName: "",
    dataType: "",
    pkValues: {},
    originalValue: null,
    newValue: typedValues,
    statement: { query, params },
  };
}

/**
 * Build a parameterized DELETE statement for a row (matched by PK).
 */
export function buildDeleteChange(input: {
  schema: string;
  table: string;
  row: Record<string, unknown>;
  pkColumns: string[];
}): PendingChange | null {
  const { schema, table, row, pkColumns } = input;
  const pkValues = getPkValues(row, pkColumns);
  const pkEntries = Object.entries(pkValues);
  if (pkEntries.length === 0) return null;
  const whereClause = pkEntries.map(([k], i) => `"${k}" = $${i + 1}`).join(" AND ");
  return {
    id: `delete-${schema}.${table}-${Date.now()}`,
    schema,
    table,
    op: "delete",
    columnName: "",
    dataType: "",
    pkValues,
    originalValue: null,
    newValue: null,
    statement: {
      query: `DELETE FROM "${schema}"."${table}" WHERE ${whereClause}`,
      params: pkEntries.map(([, v]) => v),
    },
  };
}

function getPkValues(row: Record<string, unknown>, pkColumns: string[]): Record<string, unknown> {
  const pks: Record<string, unknown> = {};
  for (const pk of pkColumns) if (pk in row) pks[pk] = row[pk];
  return pks;
}

/**
 * Convert a Glide edited cell back into its canonical string form so it can be
 * stored in a PendingChange and later bound via toSqlParamValue.
 */
export function cellEditToString(cell: EditableGridCell): string {
  switch (cell.kind) {
    case GridCellKind.Number:
      return cell.data === undefined ? "" : String(cell.data);
    case GridCellKind.Boolean:
      return cell.data === true ? "true" : cell.data === false ? "false" : "";
    case GridCellKind.Custom:
      return (cell as unknown as { data?: { display?: string } }).data?.display ?? "";
    default:
      return (cell as { data?: string }).data ?? "";
  }
}

/** Extract the enum option list from a column's dataType cache. */
export function enumOptions(dataType: string, enumValues: string[] | null | undefined): string[] | null {
  if (!isPotentialEnum(dataType)) return null;
  return enumValues && enumValues.length > 0 ? enumValues : null;
}
