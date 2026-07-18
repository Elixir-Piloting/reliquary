"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { MainLayout } from "@/components/main-layout";
import { DatabaseNavbar } from "@/components/database-navbar";
import { SQLEditor } from "@/components/sql-editor";
import { ResultsViewer } from "@/components/results-viewer";
import { QueryTabs, type QueryTab } from "@/components/query-tabs";
import { SafeModeToggle } from "@/components/safe-mode-toggle";
import { QueryConfirmationDialog } from "@/components/query-confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Persistence } from "@/lib/persistence";
import { getConnection } from "@/lib/connections/store";
import type { ConnectionConfig, QueryResult } from "@/lib/db/types";
import { Play, Plus, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

function generateTabId() { return "q-" + Date.now(); }

export default function QueryView() {
  const { connection: connectionId } = useParams<{ connection: string }>();
  const [connection, setConnection] = useState<ConnectionConfig | null>(null);
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [safeMode, setSafeMode] = useState(true);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);

  useEffect(() => {
    if (connectionId) {
      const conn = getConnection(connectionId);
      if (conn) setConnection(conn);
    }
  }, [connectionId]);

  useEffect(() => {
    if (connectionId) Persistence.setQueryTabs(connectionId, queryTabs);
  }, [connectionId, queryTabs]);

  useEffect(() => {
    if (connectionId && activeTabId) Persistence.setActiveQueryTabId(connectionId, activeTabId);
  }, [connectionId, activeTabId]);

  useEffect(() => {
    if (!connectionId) return;
    const saved = Persistence.getQueryTabs(connectionId);
    if (saved && saved.length > 0) {
      setQueryTabs(saved);
      const active = Persistence.getActiveQueryTabId(connectionId);
      setActiveTabId(active && saved.find(t => t.id === active) ? active : saved[0].id);
    } else {
      const id = generateTabId();
      setQueryTabs([{ id, label: "Query 1", query: "SELECT 1;" }]);
      setActiveTabId(id);
    }
  }, [connectionId]);

  const currentQuery = queryTabs.find(t => t.id === activeTabId)?.query || "";

  const updateQuery = useCallback((newQuery: string) => {
    if (!activeTabId) return;
    setQueryTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, query: newQuery } : t));
  }, [activeTabId]);

  const executeQuery = async (q?: string) => {
    const query = q || currentQuery;
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

  const handleExecute = () => {
    if (safeMode) {
      const trimmed = currentQuery.trim().toLowerCase();
      if (trimmed.startsWith("drop") || trimmed.startsWith("delete") || trimmed.startsWith("truncate") || trimmed.startsWith("update") || trimmed.startsWith("alter")) {
        setPendingQuery(currentQuery);
        setShowConfirmation(true);
        return;
      }
    }
    executeQuery();
  };

  const addTab = () => {
    const id = generateTabId();
    const count = queryTabs.length + 1;
    setQueryTabs(prev => [...prev, { id, label: `Query ${count}`, query: "SELECT 1;" }]);
    setActiveTabId(id);
  };

  const closeTab = (tabId: string) => {
    setQueryTabs(prev => {
      const updated = prev.filter(t => t.id !== tabId);
      if (updated.length === 0) {
        const id = generateTabId();
        return [{ id, label: "Query 1", query: "SELECT 1;" }];
      }
      return updated;
    });
    if (activeTabId === tabId) {
      const remaining = queryTabs.filter(t => t.id !== tabId);
      setActiveTabId(remaining[0]?.id || null);
    }
  };

  const renameTab = (tabId: string, newLabel: string) => {
    setQueryTabs(prev => prev.map(t => t.id === tabId ? { ...t, label: newLabel } : t));
  };

  return (
    <MainLayout>
      <div className="flex flex-col h-full">
        <DatabaseNavbar connectionId={connectionId || ""} />
        <QueryTabs tabs={queryTabs} activeTabId={activeTabId} onTabSelect={setActiveTabId} onTabClose={closeTab} onTabRename={renameTab} />
        <div className="flex flex-col flex-1 min-h-0">
          <div className="h-12 border-b border-border flex items-center gap-2 px-4 shrink-0 overflow-x-auto">
            <Button onClick={handleExecute} disabled={loading || !currentQuery.trim()}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Run Query
            </Button>
            <span className="text-xs text-muted-foreground">Ctrl/Cmd + Enter</span>
            <div className="flex-1" />
            <SafeModeToggle enabled={safeMode} onToggle={setSafeMode} />
            <Button variant="ghost" size="sm" onClick={addTab}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="flex-1 min-h-0">
            <SQLEditor value={currentQuery} onChange={updateQuery} onExecute={handleExecute} />
          </div>
          <div className="h-96 border-t border-border shrink-0">
            <ResultsViewer result={result} error={error} loading={loading} provider={connection?.provider} />
          </div>
        </div>
      </div>
      <QueryConfirmationDialog open={showConfirmation} onOpenChange={setShowConfirmation} query={pendingQuery || ""}
        onConfirm={() => { setShowConfirmation(false); executeQuery(pendingQuery!); setPendingQuery(null); }}
        onCancel={() => { setShowConfirmation(false); setPendingQuery(null); }} />
    </MainLayout>
  );
}
