import type { ConnectionConfig } from "@/lib/db/types";

export interface LocalPostgresServer {
  key: string;
  host: string;
  port: number;
  version?: string;
  running: boolean;
  expanded?: boolean;
}

export interface LocalPostgresManagerProps {
  onServerSelect: (config: ConnectionConfig) => void;
}
