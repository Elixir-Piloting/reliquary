export interface ParsedConnectionURL {
  provider: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  sslmode?: string;
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

      return { provider: "postgresql", host: decodeURIComponent(host), port, database: database ? decodeURIComponent(database) : "", user, password, ssl, sslmode: sslMode || undefined };
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
  const sslMode = new URLSearchParams(queryString).get("sslmode") || undefined;
  const ssl = sslMode === "require" || sslMode === "prefer" || new URLSearchParams(queryString).get("ssl") === "true";

  if (!decodedHost) throw new Error("Missing host");
  return { provider: "postgresql", host: decodedHost, port, database: decodedDatabase, user: decodedUser, password: decodedPassword, ssl, sslmode: sslMode };
}

export function parseConnectionURL(url: string): ParsedConnectionURL {
  url = url.trim();
  const detected = detectProviderFromConnectionString(url);
  const result = basePostgres(url);
  if (detected) result.provider = detected;
  return result;
}

export function buildConnectionURL(config: { host: string; port: number; database: string; user: string; password: string; ssl?: boolean; sslmode?: string }): string {
  const { host, port, database, user, password, ssl, sslmode } = config;
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  const encodedHost = encodeURIComponent(host);
  let url = `postgresql://${encodedUser}:${encodedPassword}@${encodedHost}:${port}/${encodeURIComponent(database)}`;
  const mode = sslmode || (ssl ? "require" : undefined);
  if (mode) url += `?sslmode=${mode}`;
  return url;
}

/**
 * Rewrite (or append) the `sslmode` query parameter on an existing PostgreSQL
 * connection URL, preserving credentials, host, port, database and any other
 * query params. Falls back to the raw URL if it cannot be parsed.
 */
export function withSslMode(url: string, sslmode: string): string {
  if (!url) return url;
  const httpUrl = url.replace(/^(postgresql|postgres):\/\//, "http://");
  try {
    const u = new URL(httpUrl);
    u.searchParams.set("sslmode", sslmode);
    return u.toString().replace(/^http:\/\//, "postgresql://");
  } catch {
    return url;
  }
}