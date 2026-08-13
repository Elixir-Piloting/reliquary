export interface LocalPostgresServer {
  key: string;
  host: string;
  port: number;
  version?: string;
  running: boolean;
  expanded?: boolean;
}

export interface LocalPostgresConnectionDraft {
  name: string;
  url: string;
  provider?: string;
}

export interface LocalPostgresManagerProps {
  onServerSelect: (config: LocalPostgresConnectionDraft) => void;
}
