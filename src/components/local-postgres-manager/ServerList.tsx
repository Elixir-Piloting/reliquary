"use client";
import { ChevronDown, ChevronRight, Loader2, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LocalPostgresServer } from "./types";
import type { LocalPgDatabase } from "@/lib/ipc-client";

interface ServerListProps {
  servers: LocalPostgresServer[];
  databases: Record<string, LocalPgDatabase[]>;
  loadingDb: string | null;
  onServerExpand: (server: LocalPostgresServer) => void;
  onDatabaseConnect: (server: LocalPostgresServer, db: LocalPgDatabase) => void;
  isDetecting?: boolean;
}

export function ServerList({ servers, databases, loadingDb, onServerExpand, onDatabaseConnect, isDetecting }: ServerListProps) {
  if (servers.length === 0 && !isDetecting) {
    return <div className="text-sm text-muted-foreground py-8 text-center">No local PostgreSQL servers detected. Make sure PostgreSQL is running and accessible.</div>;
  }

  if (isDetecting && servers.length === 0) {
    return <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" />Detecting servers...</div>;
  }

  return (
    <div className="space-y-2">
      {servers.filter(s => s.running).map(server => {
        const serverKey = `${server.host}:${server.port}`;
        const dbs = databases[serverKey];
        const isLoading = loadingDb === serverKey;
        return (
          <div key={serverKey} className="border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => onServerExpand(server)}>
              <div className="flex items-center gap-2">
                {server.expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <div>
                  <div className="font-medium text-sm">{server.host}:{server.port}</div>
                  {server.version && <div className="text-xs text-muted-foreground">{server.version}</div>}
                </div>
              </div>
            </div>
            {server.expanded && (
              <div className="border-t p-2 bg-background">
                {isLoading ? (
                  <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
                ) : dbs && dbs.length > 0 ? (
                  <div className="space-y-1">
                    {dbs.map(db => (
                      <button key={db.name} className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-md transition-colors"
                        onClick={() => onDatabaseConnect(server, db)}>
                        <Database className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="flex-1">{db.name}</span>
                        {db.size && <span className="text-xs text-muted-foreground">{db.size}</span>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground py-2 text-center">No databases found</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
