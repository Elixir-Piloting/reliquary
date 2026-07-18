import { invoke } from "@tauri-apps/api/core";

export interface Connection {
  id: string;
  name: string;
  url: string;
  provider?: string;
  color?: string;
  createdAt?: string;
}

export interface SchemaInfo {
  schema_name: string;
  tables_count?: number;
}

export interface TableInfo {
  table_name: string;
  schema_name: string;
  type: string;
  row_count?: number;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  default_value: string | null;
  max_length?: number | null;
}

export interface IndexInfo {
  index_name: string;
  column_name: string;
  is_unique: boolean;
  is_primary: boolean;
  index_type: string;
}

export interface ConstraintInfo {
  constraint_name: string;
  constraint_type: string;
  column_name: string;
  foreign_table_schema: string | null;
  foreign_table_name: string | null;
  foreign_column_name: string | null;
}

export interface RelationshipInfo {
  constraint_name: string;
  source_schema: string;
  source_table: string;
  source_column: string;
  target_schema: string;
  target_table: string;
  target_column: string;
}

export interface TableDataResult {
  columns: Array<{ name: string; data_type: string }>;
  rows: Record<string, unknown>[];
  total_count: number;
}

export interface QueryResult {
  columns: Array<{ name: string; data_type: string }>;
  rows: Record<string, unknown>[];
  row_count: number;
  affected_rows?: number;
  is_select: boolean;
  execution_time_ms: number;
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
  server_version?: string;
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
  async addConnection(config: { name: string; url: string }): Promise<Connection> {
    return invoke("add_connection", { name: config.name, url: config.url });
  },
  async updateConnection(id: string, updates: { name?: string; url?: string }): Promise<void> {
    return invoke("update_connection", { id, name: updates.name, url: updates.url });
  },
  async deleteConnection(id: string): Promise<void> {
    return invoke("delete_connection", { id });
  },
  async testConnection(url: string): Promise<TestConnectionResult> {
    return invoke("test_connection", { url });
  },

  // Connection lifecycle
  async connect(connectionId: string): Promise<void> {
    return invoke("connect", { connectionId });
  },
  async disconnect(connectionId: string): Promise<void> {
    return invoke("disconnect", { connectionId });
  },
  async isConnected(connectionId: string): Promise<boolean> {
    return invoke("is_connected", { connectionId });
  },

  // Schema introspection
  async getSchemas(connectionId: string): Promise<SchemaInfo[]> {
    return invoke("get_schemas", { connectionId });
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

  // Table data
  async getTableData(connectionId: string, schema: string, table: string, page: number, pageSize: number, sortColumn?: string, sortDirection?: string): Promise<TableDataResult> {
    return invoke("get_table_data", { connectionId, schema, table, page, pageSize, sortColumn, sortDirection });
  },

  // Queries
  async executeQuery(connectionId: string, query: string): Promise<QueryResult> {
    return invoke("execute_query", { connectionId, query });
  },

  // Local PostgreSQL
  async detectLocalServers(): Promise<LocalPgServer[]> {
    return invoke("detect_local_servers");
  },
  async listLocalDatabases(host: string, port: number): Promise<LocalPgDatabase[]> {
    return invoke("list_local_databases", { host, port });
  },
  async createLocalDatabase(host: string, port: number, dbName: string): Promise<void> {
    return invoke("create_local_database", { host, port, dbName });
  },
  async dropLocalDatabase(host: string, port: number, dbName: string): Promise<void> {
    return invoke("drop_local_database", { host, port, dbName });
  },
};

export function getDefaultConnectionId(): string {
  return getConnectionId();
}

export default API;
