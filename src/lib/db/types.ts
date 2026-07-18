export interface ConnectionConfig {
  id: string;
  name: string;
  provider: string;
  filePath?: string;
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

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
}

export interface SchemaInfo {
  schemaName: string;
  tablesCount?: number;
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
