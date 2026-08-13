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

export function getProviderMetadata(_provider?: string): ProviderMetadata {
  return POSTGRESQL_PROVIDER;
}