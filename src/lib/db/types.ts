import type { Connection } from "@/lib/ipc-client";

/**
 * A stored connection, mirroring the Rust `StoredConnection` (serde camelCase).
 * The IPC `Connection` type is the single canonical shape; this alias exists so
 * existing consumers keep the `ConnectionConfig` name.
 */
export type ConnectionConfig = Connection;

export interface ColumnMeta {
  name: string;
  dataType: string;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  rowCount: number;
  affectedRows?: number;
  isSelect: boolean;
  executionTimeMs: number;
}

export interface TableInfo {
  tableName: string;
  schemaName: string;
  tableType: string;
  rowCount?: number;
  hasRls?: boolean;
}

export interface SchemaInfo {
  schemaName: string;
  tablesCount?: number;
}

export interface ViewInfo {
  viewName: string;
  definition: string;
}

export interface TriggerInfo {
  triggerName: string;
  eventManipulation: string;
  actionTiming: string;
  actionStatement: string;
  enabled: boolean;
}

export interface FunctionInfo {
  functionName: string;
  arguments: string;
  returnType: string;
  language: string;
  volatility: string;
  securityDefiner: boolean;
}

export interface RlsPolicyInfo {
  policyName: string;
  command: string;
  roles: string[];
  usingExpression?: string | null;
  checkExpression?: string | null;
}

export interface RoleInfo {
  roleName: string;
  superuser: boolean;
  createdb: boolean;
  createrole: boolean;
  login: boolean;
  connectionLimit: number;
  memberOf: string[];
}

export interface TableDataResult {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  totalCount: number;
}

export interface ColumnInfo {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string | null;
  maxLength: number | null;
}

export interface IndexInfo {
  indexName: string;
  columnName: string;
  isUnique: boolean;
  isPrimary: boolean;
  indexType: string;
}

export interface ConstraintInfo {
  constraintName: string;
  constraintType: string;
  columnName: string;
  foreignTableSchema: string | null;
  foreignTableName: string | null;
  foreignColumnName: string | null;
}

export interface RelationshipInfo {
  constraintName: string;
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
}
