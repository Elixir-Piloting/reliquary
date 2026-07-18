export const queryKeys = {
  connections: {
    all: ["connections"] as const,
    test: (config: unknown) => ["connections", "test", config] as const,
  },
  db: {
    status: (connectionId: string) => ["db", "status", connectionId] as const,
    schema: (connectionId: string) => ["db", "schema", connectionId] as const,
    database: (connectionId: string) => ["db", "database", connectionId] as const,
    tables: (connectionId: string, schema: string) => ["db", "tables", connectionId, schema] as const,
    tableData: (connectionId: string, schema: string, table: string, page: number, pageSize: number) =>
      ["db", "tableData", connectionId, schema, table, page, pageSize] as const,
    columns: (connectionId: string, schema: string, table: string) =>
      ["db", "columns", connectionId, schema, table] as const,
    indexes: (connectionId: string, schema: string, table: string) =>
      ["db", "indexes", connectionId, schema, table] as const,
    constraints: (connectionId: string, schema: string, table: string) =>
      ["db", "constraints", connectionId, schema, table] as const,
    relationships: (connectionId: string, schema: string, table: string) =>
      ["db", "relationships", connectionId, schema, table] as const,
  },
  localPg: {
    servers: ["localPg", "servers"] as const,
    databases: (serverKey: string) => ["localPg", "databases", serverKey] as const,
  },
  query: (connectionId: string) => ["query", connectionId] as const,
};
