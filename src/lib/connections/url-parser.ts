export interface ParsedConnectionURL {
  provider: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

export function detectProviderFromConnectionString(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.includes("neon.tech") || lower.includes("neondb")) return "neon";
  if (lower.includes("supabase.co") || lower.includes("pooler.supabase")) return "supabase";
  if (lower.startsWith("postgresql://") || lower.startsWith("postgres://")) return "postgresql";
  return null;
}

function basePostgres(url: string): ParsedConnectionURL {
  const lower = url.toLowerCase();
  const isPostgreSQL = lower.startsWith("postgresql://") || lower.startsWith("postgres://");
  if (!isPostgreSQL) throw new Error("Invalid connection URL format. Only PostgreSQL URLs are supported.");

  const atCount = (lower.match(/@/g) || []).length;
  const hasUnencodedAt = atCount > 1;

  if (!hasUnencodedAt) {
    try {
      const tempUrl = url.replace(/^(postgresql|postgres):\/\//, "http://");
      const parsedUrl = new URL(tempUrl);
      const host = parsedUrl.hostname;
      const portStr = parsedUrl.port;
      const pathname = parsedUrl.pathname;
      const searchParams = parsedUrl.searchParams;
      const user = parsedUrl.username ? decodeURIComponent(parsedUrl.username) : "";
      const password = parsedUrl.password ? decodeURIComponent(parsedUrl.password) : "";
      const database = pathname.replace(/^\//, "").split("?")[0];
      const sslMode = searchParams.get("sslmode") || searchParams.get("ssl_mode");
      const ssl = sslMode === "require" || sslMode === "prefer" || searchParams.get("ssl") === "true";

      const port = portStr ? parseInt(portStr, 10) : 5432;
      if (!host) throw new Error("Missing host");

      return { provider: "postgresql", host: decodeURIComponent(host), port, database: database ? decodeURIComponent(database) : "", user, password, ssl };
    } catch { /* fall through */ }
  }

  const protocolMatch = url.match(/^(postgresql|postgres):\/\//);
  if (!protocolMatch) throw new Error("Invalid connection URL format. Only PostgreSQL URLs are supported.");

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
  const port = portStr ? parseInt(portStr, 10) : 5432;
  const decodedUser = user ? decodeURIComponent(user) : "";
  const decodedPassword = password ? decodeURIComponent(password) : "";
  const decodedHost = host ? decodeURIComponent(host) : "";
  const decodedDatabase = database ? decodeURIComponent(database) : "";
  const ssl = new URLSearchParams(queryString).get("sslmode") === "require" || new URLSearchParams(queryString).get("ssl") === "true";

  if (!decodedHost) throw new Error("Missing host");
  return { provider: "postgresql", host: decodedHost, port, database: decodedDatabase, user: decodedUser, password: decodedPassword, ssl };
}

export function parseConnectionURL(url: string): ParsedConnectionURL {
  url = url.trim();
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