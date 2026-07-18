export enum DatabaseProvider {
  POSTGRESQL = "postgresql",
  MYSQL = "mysql",
  MARIADB = "mariadb",
  SQLSERVER = "sqlserver",
  CLICKHOUSE = "clickhouse",
  REDIS = "redis",
  MONGODB = "mongodb",
  SQLITE = "sqlite",
  LIBSQL = "libsql",
  SUPABASE = "supabase",
  PLANETSCALE = "planetscale",
  NEON = "neon",
}

export interface ProviderMetadata {
  id: DatabaseProvider;
  name: string;
  icon: string;
  iconType?: "image" | "emoji";
  defaultPort: number;
  color: string;
  description: string;
  connectionType: "fields" | "url" | "file" | "fields-or-url";
  requiredFields?: string[];
  warning?: string;
  urlPlaceholder?: string;
  urlProtocol?: string;
  supported?: boolean;
}

export const PROVIDER_METADATA: Record<DatabaseProvider, ProviderMetadata> = {
  [DatabaseProvider.POSTGRESQL]: {
    id: DatabaseProvider.POSTGRESQL,
    name: "PostgreSQL",
    icon: "/icons/postgresql.png",
    iconType: "image",
    defaultPort: 5432,
    color: "#336791",
    description: "Advanced open-source relational database",
    connectionType: "fields-or-url",
    requiredFields: ["host", "database", "user"],
    urlPlaceholder: "postgresql://user:password@host:port/database",
    urlProtocol: "postgresql://",
  },
  [DatabaseProvider.MYSQL]: {
    id: DatabaseProvider.MYSQL,
    name: "MySQL",
    icon: "/icons/mysql.png",
    iconType: "image",
    defaultPort: 3306,
    color: "#00758C",
    description: "Popular open-source relational database",
    connectionType: "fields-or-url",
    requiredFields: ["host", "database", "user"],
    urlPlaceholder: "mysql://user:password@host:port/database",
    urlProtocol: "mysql://",
  },
  [DatabaseProvider.MARIADB]: {
    id: DatabaseProvider.MARIADB,
    name: "MariaDB",
    icon: "/icons/mariadb.png",
    iconType: "image",
    defaultPort: 3306,
    color: "#1F2E54",
    description: "MySQL-compatible relational database",
    connectionType: "fields-or-url",
    requiredFields: ["host", "database", "user"],
    urlPlaceholder: "mysql://user:password@host:port/database",
    urlProtocol: "mysql://",
  },
  [DatabaseProvider.MONGODB]: {
    id: DatabaseProvider.MONGODB,
    name: "MongoDB",
    icon: "/icons/mongodb.png",
    iconType: "image",
    defaultPort: 27017,
    color: "#001E2B",
    description: "NoSQL document database",
    connectionType: "fields-or-url",
    requiredFields: ["host", "database", "user"],
    urlPlaceholder: "mongodb+srv://user:password@host/database",
    urlProtocol: "mongodb+srv://",
  },
  [DatabaseProvider.SQLITE]: {
    id: DatabaseProvider.SQLITE,
    name: "SQLite",
    icon: "/icons/sqlite.png",
    iconType: "image",
    defaultPort: 0,
    color: "#003545",
    description: "Embedded SQL database engine",
    connectionType: "file",
    requiredFields: ["filePath"],
  },
  [DatabaseProvider.LIBSQL]: {
    id: DatabaseProvider.LIBSQL,
    name: "LibSQL / Turso",
    icon: "/icons/turso.png",
    iconType: "image",
    defaultPort: 0,
    color: "#000000",
    description: "Edge SQL database powered by SQLite",
    connectionType: "url",
    requiredFields: ["connectionString"],
    urlPlaceholder: "libsql://host/database",
    urlProtocol: "libsql://",
    supported: false,
  },
  [DatabaseProvider.SUPABASE]: {
    id: DatabaseProvider.SUPABASE,
    name: "Supabase",
    icon: "/icons/supabase.png",
    iconType: "image",
    defaultPort: 5432,
    color: "#3ECF8E",
    description: "Open-source Firebase alternative (PostgreSQL)",
    connectionType: "url",
    requiredFields: ["connectionString"],
    urlPlaceholder: "postgresql://user:password@host:port/database",
    urlProtocol: "postgresql://",
    warning: "IPv4 Compatibility Notice: Supabase direct connections require IPv6 support.",
  },
  [DatabaseProvider.PLANETSCALE]: {
    id: DatabaseProvider.PLANETSCALE,
    name: "PlanetScale",
    icon: "/icons/planetscale.png",
    iconType: "image",
    defaultPort: 3306,
    color: "#000000",
    description: "Serverless MySQL platform",
    connectionType: "url",
    requiredFields: ["connectionString"],
    urlPlaceholder: "mysql://user:password@host:port/database",
    urlProtocol: "mysql://",
  },
  [DatabaseProvider.SQLSERVER]: {
    id: DatabaseProvider.SQLSERVER,
    name: "SQL Server",
    icon: "/icons/sqlserver.png",
    iconType: "image",
    defaultPort: 1433,
    color: "#CC2927",
    description: "Microsoft SQL Server",
    connectionType: "fields-or-url",
    requiredFields: ["host", "database", "user"],
    urlPlaceholder: "sqlserver://user:password@host:port/database",
    urlProtocol: "sqlserver://",
    supported: false,
  },
  [DatabaseProvider.CLICKHOUSE]: {
    id: DatabaseProvider.CLICKHOUSE,
    name: "ClickHouse",
    icon: "/icons/clickhouse.png",
    iconType: "image",
    defaultPort: 8123,
    color: "#F3B300",
    description: "Open-source column-oriented DBMS",
    connectionType: "fields-or-url",
    requiredFields: ["host", "database", "user"],
    urlPlaceholder: "clickhouse://user:password@host:port/database",
    urlProtocol: "clickhouse://",
    supported: false,
  },
  [DatabaseProvider.REDIS]: {
    id: DatabaseProvider.REDIS,
    name: "Redis",
    icon: "/icons/redis.png",
    iconType: "image",
    defaultPort: 6379,
    color: "#DC382D",
    description: "In-memory data structure store",
    connectionType: "url",
    requiredFields: ["connectionString"],
    urlPlaceholder: "redis://user:password@host:port",
    urlProtocol: "redis://",
    supported: false,
  },
  [DatabaseProvider.NEON]: {
    id: DatabaseProvider.NEON,
    name: "Neon",
    icon: "/icons/neon.png",
    iconType: "image",
    defaultPort: 5432,
    color: "#0FE5D3",
    description: "Serverless PostgreSQL",
    connectionType: "url",
    requiredFields: ["connectionString"],
    urlPlaceholder: "postgresql://user:password@host:port/database",
    urlProtocol: "postgresql://",
  },
};

export function getProviderMetadata(provider: DatabaseProvider): ProviderMetadata {
  return PROVIDER_METADATA[provider];
}

export function getAllProviders(): ProviderMetadata[] {
  return Object.values(PROVIDER_METADATA);
}
