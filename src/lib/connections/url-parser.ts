export interface ParsedConnectionURL {
  provider: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  isSupabase?: boolean;
  isSessionPooler?: boolean;
}

function basePostgres(url: string): ParsedConnectionURL {
  const lower = url.toLowerCase();
  const isMongoDB = lower.startsWith("mongodb://") || lower.startsWith("mongodb+srv://");
  const isMySQL = lower.startsWith("mysql://");
  const isPostgreSQL = lower.startsWith("postgresql://") || lower.startsWith("postgres://");
  const isLibSQL = lower.startsWith("libsql://");
  const isRedis = lower.startsWith("redis://");
  const isClickHouse = lower.startsWith("clickhouse://");

  if (isMongoDB && lower.startsWith("mongodb+srv://")) {
    return parseMongoDBSRV(url);
  }

  const atCount = (lower.match(/@/g) || []).length;
  const hasUnencodedAt = atCount > 1;

  if (!hasUnencodedAt) {
    try {
      let tempUrl = url;
      if (isPostgreSQL) tempUrl = url.replace(/^(postgresql|postgres):\/\//, "http://");
      else if (isMySQL) tempUrl = url.replace(/^mysql:\/\//, "http://");
      else if (isMongoDB) tempUrl = url.replace(/^mongodb:\/\//, "http://");
      else if (isLibSQL) tempUrl = url.replace(/^libsql:\/\//, "http://");
      else if (isRedis) tempUrl = url.replace(/^redis:\/\//, "http://");
      else if (isClickHouse) tempUrl = url.replace(/^clickhouse:\/\//, "http://");

      const parsedUrl = new URL(tempUrl);
      const host = parsedUrl.hostname;
      const portStr = parsedUrl.port;
      const pathname = parsedUrl.pathname;
      const searchParams = parsedUrl.searchParams;
      const user = parsedUrl.username ? decodeURIComponent(parsedUrl.username) : "";
      const password = parsedUrl.password ? decodeURIComponent(parsedUrl.password) : "";
      const database = pathname.replace(/^\//, "").split("?")[0];
      const sslMode = searchParams.get("sslmode") || searchParams.get("ssl_mode");
      const ssl = sslMode === "require" || sslMode === "prefer" || searchParams.get("ssl") === "true" || isMongoDB;

      let defaultPort = 5432;
      if (isMySQL) defaultPort = 3306;
      else if (isMongoDB) defaultPort = 27017;
      else if (isRedis) defaultPort = 6379;
      else if (isClickHouse) defaultPort = 9000;

      const port = portStr ? parseInt(portStr, 10) : defaultPort;
      if (!host) throw new Error("Missing host");

      return { provider: "postgresql", host: decodeURIComponent(host), port, database: database ? decodeURIComponent(database) : "", user, password, ssl };
    } catch { /* fall through */ }
  }

  const protocolMatch = url.match(/^(postgresql|postgres|mysql|mongodb|libsql|redis|clickhouse):\/\//);
  if (!protocolMatch) throw new Error("Invalid connection URL format");

  const protocol = protocolMatch[1];
  const afterProtocol = url.substring(protocolMatch[0].length);
  const dbSlashIndex = afterProtocol.indexOf('/');
  let beforeDb: string, afterDb: string, database = "", queryString = "";

  if (dbSlashIndex === -1) { beforeDb = afterProtocol; afterDb = ""; }
  else { beforeDb = afterProtocol.substring(0, dbSlashIndex); afterDb = afterProtocol.substring(dbSlashIndex + 1); [database, queryString = ""] = afterDb.split('?'); }

  const lastAt = beforeDb.lastIndexOf('@');
  let user = "", password = "", hostPort = beforeDb;
  if (lastAt !== -1) {
    const credentials = beforeDb.substring(0, lastAt);
    hostPort = beforeDb.substring(lastAt + 1);
    const colonIndex = credentials.indexOf(':');
    if (colonIndex !== -1) { user = credentials.substring(0, colonIndex); password = credentials.substring(colonIndex + 1); }
    else { user = credentials; }
  }

  const [host, portStr = ""] = hostPort.split(':');
  let defaultPort = 5432;
  if (protocol === "mysql") defaultPort = 3306;
  else if (protocol === "mongodb") defaultPort = 27017;
  else if (protocol === "redis") defaultPort = 6379;
  else if (protocol === "clickhouse") defaultPort = 9000;

  const port = portStr ? parseInt(portStr, 10) : defaultPort;
  const decodedUser = user ? decodeURIComponent(user) : "";
  const decodedPassword = password ? decodeURIComponent(password) : "";
  const decodedHost = host ? decodeURIComponent(host) : "";
  const decodedDatabase = database ? decodeURIComponent(database) : "";
  const ssl = new URLSearchParams(queryString).get("sslmode") === "require" || new URLSearchParams(queryString).get("ssl") === "true";

  if (!decodedHost) throw new Error("Missing host");
  return { provider: "postgresql", host: decodedHost, port, database: decodedDatabase, user: decodedUser, password: decodedPassword, ssl };
}

function parseMongoDBSRV(url: string): ParsedConnectionURL {
  const protocolMatch = url.match(/^mongodb\+srv:\/\//);
  if (!protocolMatch) throw new Error("Invalid MongoDB SRV URL format");
  const afterProtocol = url.substring(protocolMatch[0].length);
  const dbSlashIndex = afterProtocol.indexOf('/');
  let beforeDb: string, afterDb: string, database = "", queryString = "";
  if (dbSlashIndex === -1) { beforeDb = afterProtocol; afterDb = ""; }
  else { beforeDb = afterProtocol.substring(0, dbSlashIndex); afterDb = afterProtocol.substring(dbSlashIndex + 1); [database, queryString = ""] = afterDb.split('?'); }
  const lastAt = beforeDb.lastIndexOf('@');
  let user = "", password = "", host = beforeDb;
  if (lastAt !== -1) {
    const credentials = beforeDb.substring(0, lastAt);
    host = beforeDb.substring(lastAt + 1);
    const colonIndex = credentials.indexOf(':');
    if (colonIndex !== -1) { user = credentials.substring(0, colonIndex); password = credentials.substring(colonIndex + 1); }
    else { user = credentials; }
  }
  return { provider: "mongodb", host: host ? decodeURIComponent(host) : "", port: 27017, database: database ? decodeURIComponent(database) : "", user: user ? decodeURIComponent(user) : "", password: password ? decodeURIComponent(password) : "", ssl: true };
}

export function detectProviderFromConnectionString(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.includes("neon.tech") || lower.includes("neondb")) return "neon";
  if (lower.includes("supabase.co") || lower.includes("pooler.supabase")) return "supabase";
  if (lower.includes("planetscale")) return "planetscale";
  if (lower.includes("cloudflare") || lower.includes(".d1.")) return "postgresql";
  if (lower.includes("val.town") || lower.includes("valtown")) return "postgresql";
  if (lower.includes("turso") || lower.includes("libsql")) return "libsql";
  if (lower.startsWith("postgresql://") || lower.startsWith("postgres://")) return "postgresql";
  if (lower.startsWith("mysql://") || lower.startsWith("mariadb://")) return lower.includes("mariadb") ? "mariadb" : "mysql";
  if (lower.startsWith("mongodb://") || lower.startsWith("mongodb+srv://")) return "mongodb";
  if (lower.startsWith("redis://")) return "redis";
  if (lower.startsWith("clickhouse://")) return "clickhouse";
  if (lower.endsWith(".db") || lower.endsWith(".sqlite") || lower.endsWith(".sqlite3")) return "sqlite";
  if (/\/[^/]+\.(db|sqlite|sqlite3)$/.test(lower)) return "sqlite";
  if (lower.includes("server=") || lower.includes("data source=")) return "sqlserver";
  if (lower.includes("postgres")) return "postgresql";
  return null;
}

export function parseConnectionURL(url: string): ParsedConnectionURL {
  url = url.trim();
  const lower = url.toLowerCase();
  const detected = detectProviderFromConnectionString(url);
  const result = basePostgres(url);
  if (detected) result.provider = detected;
  return result;
}

export function buildConnectionURL(config: { host: string; port: number; database: string; user: string; password: string; ssl?: boolean }): string {
  const { host, port, database, user, password, ssl } = config;
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  const encodedHost = encodeURIComponent(host);
  let url = `postgresql://${encodedUser}:${encodedPassword}@${encodedHost}:${port}/${encodeURIComponent(database)}`;
  if (ssl) url += "?sslmode=require";
  return url;
}
