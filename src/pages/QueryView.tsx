"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { MainLayout } from "@/components/main-layout";
import { DatabaseNavbar } from "@/components/database-navbar";
import { ResultsViewer } from "@/components/results-viewer";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/connections/store";
import type { ConnectionConfig, QueryResult } from "@/lib/db/types";
import { Play, Plus, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

export default function QueryView() {
  const { connection: connectionId } = useParams<{ connection: string }>();
  const [connection, setConnection] = useState<ConnectionConfig | null>(null);
  const [query, setQuery] = useState("SELECT 1;");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (connectionId) {
      const conn = getConnection(connectionId);
      if (conn) setConnection(conn);
    }
  }, [connectionId]);

  const executeQuery = async () => {
    if (!query.trim() || !connectionId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await invoke<QueryResult>("execute_query", { connectionId, query });
      setResult(res);
    } catch (e: any) {
      setError(String(e));
    }
    setLoading(false);
  };

  return (
    <MainLayout>
      <div className="flex flex-col h-full">
        <DatabaseNavbar connectionId={connectionId || ""} />
        <div className="flex flex-col flex-1 min-h-0">
          <div className="h-12 border-b border-border flex items-center gap-2 px-4 shrink-0 overflow-x-auto">
            <Button onClick={executeQuery} disabled={loading || !query.trim()}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Run Query
            </Button>
            <span className="text-xs text-muted-foreground ml-2">Ctrl/Cmd + Enter</span>
          </div>
          <div className="flex-1 min-h-0 p-4">
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); executeQuery(); } }}
              className="w-full h-full bg-card border border-border rounded-lg p-4 font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Enter your SQL query here..."
              spellCheck={false}
            />
          </div>
          <div className="h-96 border-t border-border shrink-0">
            <ResultsViewer result={result} error={error} loading={loading} provider={connection?.provider} />
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
