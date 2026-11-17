export interface ProviderMetadata {
  id: string;
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

export const POSTGRESQL_PROVIDER: ProviderMetadata = {
  id: "postgresql",
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
};

export const NEON_PROVIDER: ProviderMetadata = {
  id: "neon",
  name: "Neon",
  icon: "/icons/neon.png",
  iconType: "image",
  defaultPort: 5432,
  color: "#00E599",
  description: "Serverless Postgres on Neon",
  connectionType: "url",
  requiredFields: ["host", "database", "user"],
  urlPlaceholder: "postgresql://user:password@host:port/database",
  urlProtocol: "postgresql://",
};

export const SUPABASE_PROVIDER: ProviderMetadata = {
  id: "supabase",
  name: "Supabase",
  icon: "/icons/supabase.png",
  iconType: "image",
  defaultPort: 5432,
  color: "#3ECF8E",
  description: "Postgres hosted on Supabase",
  connectionType: "url",
  requiredFields: ["host", "database", "user"],
  urlPlaceholder: "postgresql://user:password@host:port/database",
  urlProtocol: "postgresql://",
};

const PROVIDERS: Record<string, ProviderMetadata> = {
  postgresql: POSTGRESQL_PROVIDER,
  neon: NEON_PROVIDER,
  supabase: SUPABASE_PROVIDER,
};

export function getProviderMetadata(provider?: string): ProviderMetadata {
  return PROVIDERS[provider || "postgresql"] ?? POSTGRESQL_PROVIDER;
}