import { invoke } from "@tauri-apps/api/core";
import type { TableFilter } from "@/lib/db/types";

export interface Connection {
  id: string;
  name: string;
  url: string;
  provider?: string;
  color?: string;
  createdAt?: string;
  sslmode?: string;
  readOnly?: boolean;
  neonApiKey?: string;
}

export interface SchemaInfo {
  schemaName: string;
  tablesCount?: number;
}

export interface TableInfo {
  tableName: string;
  schemaName: string;
  tableType: string;
  rowCount?: number;
  hasRls?: boolean;
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

export interface ColumnInfo {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string | null;
  maxLength?: number | null;
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

export interface TableDataResult {
  columns: Array<{ name: string; dataType: string }>;
  rows: Record<string, unknown>[];
  totalCount: number;
}

export interface QueryOptions {
  confirmDestructive: boolean;
  readOnly: boolean;
}

export interface RowMutationStatement {
  query: string;
  params: unknown[];
}

export interface QueryResult {
  columns: Array<{ name: string; dataType: string }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  affectedRows?: number;
  isSelect: boolean;
  executionTimeMs: number;
}

export interface ExplainResult {
  plan: unknown;
  executionTimeMs: number;
}

export interface LocalPgServer {
  key: string;
  host: string;
  port: number;
  running: boolean;
  version?: string;
}

export interface LocalPgDatabase {
  name: string;
  owner: string;
  encoding: string;
  size?: string;
}

export interface TestConnectionResult {
  success: boolean;
  error?: string;
  serverVersion?: string;
}

export interface ConnectionInfo {
  provider: string;
  host: string;
  port: string;
  database: string;
  user: string;
  serverVersion: string;
  sslmode: string;
  isSupabase: boolean;
  isNeon: boolean;
  supabaseSchemas: string[];
  readOnly: boolean;
  pooledEndpoint: boolean;
}

export interface NeonBranch {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  primary: boolean;
  connectionUri?: string;
}

function getConnectionId(): string {
  if (typeof window === "undefined") return "";
  const stored = localStorage.getItem("relic_active_connection");
  return stored || "";
}

const API = {
  // Connections
  async listConnections(): Promise<Connection[]> {
    return invoke("list_connections");
  },
  async addConnection(config: { name: string; url: string; readOnly?: boolean }): Promise<Connection> {
    return invoke("add_connection", { name: config.name, url: config.url, readOnly: config.readOnly ?? false });
  },
  async updateConnection(id: string, updates: { name?: string; url?: string; readOnly?: boolean }): Promise<void> {
    return invoke("update_connection", { id, name: updates.name, url: updates.url, readOnly: updates.readOnly });
  },
  async deleteConnection(id: string): Promise<void> {
    return invoke("delete_connection", { id });
  },
  async testConnection(url: string): Promise<TestConnectionResult> {
    return invoke("test_connection", { url });
  },

  // Connection lifecycle
  async connect(connectionId: string, url: string, readOnly: boolean): Promise<void> {
    return invoke("connect", { connectionId, url, readOnly });
  },
  async disconnect(connectionId: string): Promise<void> {
    return invoke("disconnect", { connectionId });
  },
  async isConnected(connectionId: string): Promise<boolean> {
    return invoke("is_connected", { connectionId });
  },
  async getConnectionInfo(connectionId: string): Promise<ConnectionInfo> {
    return invoke("get_connection_info", { connectionId });
  },

  // Schema introspection
  async getSchemas(connectionId: string): Promise<SchemaInfo[]> {
    return invoke("get_schemas", { connectionId });
  },
  async createSchema(connectionId: string, name: string): Promise<void> {
    return invoke("create_schema", { connectionId, name });
  },
  async getTables(connectionId: string, schema: string): Promise<TableInfo[]> {
    return invoke("get_tables", { connectionId, schema });
  },
  async getColumns(connectionId: string, schema: string, table: string): Promise<ColumnInfo[]> {
    return invoke("get_columns", { connectionId, schema, table });
  },
  async getIndexes(connectionId: string, schema: string, table: string): Promise<IndexInfo[]> {
    return invoke("get_indexes", { connectionId, schema, table });
  },
  async getConstraints(connectionId: string, schema: string, table: string): Promise<ConstraintInfo[]> {
    return invoke("get_constraints", { connectionId, schema, table });
  },
  async getRelationships(connectionId: string, schema: string, table: string): Promise<RelationshipInfo[]> {
    return invoke("get_relationships", { connectionId, schema, table });
  },
  async getViews(connectionId: string, schema: string): Promise<ViewInfo[]> {
    return invoke("get_views", { connectionId, schema });
  },
  async getTriggers(connectionId: string, schema: string, table: string): Promise<TriggerInfo[]> {
    return invoke("get_triggers", { connectionId, schema, table });
  },
  async getFunctions(connectionId: string, schema: string): Promise<FunctionInfo[]> {
    return invoke("get_functions", { connectionId, schema });
  },
  async getRlsPolicies(connectionId: string, schema: string, table: string): Promise<RlsPolicyInfo[]> {
    return invoke("get_rls_policies", { connectionId, schema, table });
  },
  async getRoles(connectionId: string): Promise<RoleInfo[]> {
    return invoke("get_roles", { connectionId });
  },
  async tableRlsStatus(connectionId: string, schema: string, table: string): Promise<boolean> {
    return invoke("table_rls_status", { connectionId, schema, table });
  },

  // Table data
  async getTableData(connectionId: string, schema: string, table: string, page: number, pageSize: number, sortColumn?: string, sortDirection?: string, filters?: TableFilter[]): Promise<TableDataResult> {
    return invoke("get_table_data", { connectionId, schema, table, page, pageSize, sortColumn, sortDirection, filters });
  },

  // Queries
  async executeQuery(connectionId: string, query: string, options?: Partial<QueryOptions>): Promise<QueryResult> {
    return invoke("execute_query", {
      connectionId,
      query,
      options: {
        confirmDestructive: false,
        readOnly: false,
        ...options,
      },
    });
  },

  async executeQueryParams(connectionId: string, query: string, params: unknown[], options?: Partial<QueryOptions>): Promise<QueryResult> {
    return invoke("execute_query_params", {
      connectionId,
      query,
      params,
      options: {
        confirmDestructive: false,
        readOnly: false,
        ...options,
      },
    });
  },

  async mutateRows(connectionId: string, statements: RowMutationStatement[]): Promise<QueryResult[]> {
    return invoke("mutate_rows", { connectionId, statements });
  },

  async explainQuery(connectionId: string, query: string, analyze: boolean): Promise<ExplainResult> {
    return invoke("explain_query", { connectionId, query, analyze });
  },

  // Neon branches
  async listNeonBranches(connectionId: string, apiKey: string): Promise<NeonBranch[]> {
    return invoke("list_neon_branches", { connectionId, apiKey });
  },
  async saveNeonApiKey(connectionId: string, apiKey: string): Promise<void> {
    return invoke("save_neon_api_key", { connectionId, apiKey });
  },

  // Local PostgreSQL
  async detectLocalServers(): Promise<LocalPgServer[]> {
    return invoke("detect_local_servers");
  },
  async listLocalDatabases(host: string, port: number, user?: string, password?: string): Promise<LocalPgDatabase[]> {
    return invoke("list_local_databases", { host, port, user, password });
  },
  async createLocalDatabase(host: string, port: number, dbName: string, user?: string, password?: string): Promise<void> {
    return invoke("create_local_database", { host, port, dbName, user, password });
  },
  async dropLocalDatabase(host: string, port: number, dbName: string, user?: string, password?: string): Promise<void> {
    return invoke("drop_local_database", { host, port, dbName, user, password });
  },
};

export function getDefaultConnectionId(): string {
  return getConnectionId();
}

export default API;
