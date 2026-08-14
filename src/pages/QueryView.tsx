"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { DatabaseNavbar } from "@/components/database-navbar";
import { SQLEditor } from "@/components/sql-editor";
import { ResultsViewer } from "@/components/results-viewer";
import { QueryTabs, type QueryTab } from "@/components/query-tabs";
import { SafeModeToggle } from "@/components/safe-mode-toggle";
import { QueryConfirmationDialog } from "@/components/query-confirmation-dialog";
import { QueryHistory } from "@/components/query-history";
import { ExplainViewer } from "@/components/explain-viewer";
import { Button } from "@/components/ui/button";
import { Persistence } from "@/lib/persistence";
import API, { type ExplainResult } from "@/lib/ipc-client";
import { isDestructiveQuery } from "@/lib/destructive-sql";
import { useSchemas } from "@/lib/query/hooks/use-schemas";
import type { QueryResult } from "@/lib/db/types";
import { Play, Plus, Loader2, FlaskConical, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";

function generateTabId() { return "q-" + Date.now(); }

export default function QueryView() {
  const { connection: connectionId } = useParams<{ connection: string }>();
  const [searchParams] = useSearchParams();
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [safeMode, setSafeMode] = useState(true);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [explainResult, setExplainResult] = useState<ExplainResult | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [analyze, setAnalyze] = useState(false);

  const schemasQuery = useSchemas(connectionId || "");
  const schemas = (schemasQuery.data || []).map(s => s.schemaName);

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

  // "Open in SQL editor" from the schema sidebar: open a tab prefilled with a
  // SELECT for the requested table (?table=schema.table).
  useEffect(() => {
    const tableParam = searchParams.get("table");
    if (!tableParam || !connectionId) return;
    const [schema, table] = tableParam.split(".");
    if (!schema || !table) return;
    const id = generateTabId();
    const query = `SELECT * FROM "${schema}"."${table}" LIMIT 100;`;
    setQueryTabs(prev => [{ id, label: `${schema}.${table}`, query }, ...prev]);
    setActiveTabId(id);
    window.history.replaceState({}, "", `/db/${connectionId}/query`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("table")]);

  const currentQuery = queryTabs.find(t => t.id === activeTabId)?.query || "";

  const updateQuery = useCallback((newQuery: string) => {
    if (!activeTabId) return;
    setQueryTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, query: newQuery } : t));
  }, [activeTabId]);

  const clearExplain = () => {
    setExplainResult(null);
    setExplainError(null);
    setExplainLoading(false);
  };

  const executeQuery = async (q?: string, confirmed = false) => {
    const query = q || currentQuery;
    if (!query.trim() || !connectionId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    clearExplain();
    try {
      const res = await invoke<QueryResult>("execute_query", {
        connectionId,
        query,
        options: {
          confirmDestructive: safeMode ? confirmed : true,
          readOnly: false,
        },
      });
      setResult(res);
      Persistence.addQueryToHistory(connectionId, query);
    } catch (e: any) {
      setError(String(e));
    }
    setLoading(false);
  };

  const runExplain = async () => {
    if (!connectionId || !currentQuery.trim()) return;
    setExplainLoading(true);
    setExplainError(null);
    setExplainResult(null);
    setResult(null);
    setError(null);
    try {
      const res = await API.explainQuery(connectionId, currentQuery, analyze);
      setExplainResult(res);
    } catch (e: any) {
      setExplainError(String(e));
    }
    setExplainLoading(false);
  };

  const handleExecute = () => {
    if (safeMode && isDestructiveQuery(currentQuery)) {
      setPendingQuery(currentQuery);
      setShowConfirmation(true);
      return;
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

  const showingExplain = explainResult !== null || explainError !== null || explainLoading;

  return (
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
            {connectionId && <QueryHistory connectionId={connectionId} onSelect={updateQuery} />}
            <Button variant="outline" size="sm" onClick={runExplain} disabled={explainLoading || !currentQuery.trim()} title="EXPLAIN (FORMAT JSON) the current query">
              {explainLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-2" />}
              Explain
            </Button>
            <Button variant={analyze ? "default" : "outline"} size="sm" onClick={() => setAnalyze(!analyze)}
              className={cn(analyze && "bg-green-600 hover:bg-green-700")} title="Run EXPLAIN ANALYZE (executes the query — read-only queries only)">
              Analyze
            </Button>
            <SafeModeToggle enabled={safeMode} onToggle={setSafeMode} />
            <Button variant="ghost" size="sm" onClick={addTab}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="flex-1 min-h-0">
            <SQLEditor value={currentQuery} onChange={updateQuery} onExecute={handleExecute}
              connectionId={connectionId} schemas={schemas}
              getTables={schema => API.getTables(connectionId || "", schema).then(ts => ts.map(t => t.tableName))}
              getColumns={(schema, table) => API.getColumns(connectionId || "", schema, table).then(cs => cs.map(c => c.columnName))} />
          </div>
          <div className="h-96 border-t border-border shrink-0">
            {showingExplain ? (
              <>
                <div className="flex h-8 items-center gap-2 border-b border-border bg-muted/20 px-3">
                  <span className="text-xs text-muted-foreground">
                    {explainLoading ? "Running EXPLAIN…" : analyze ? "EXPLAIN ANALYZE" : "EXPLAIN"}
                  </span>
                  <div className="flex-1" />
                  <button onClick={clearExplain} className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground" title="Back to results">
                    <X className="h-3 w-3" /> Close
                  </button>
                </div>
                {explainLoading ? (
                  <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Running EXPLAIN…
                  </div>
                ) : explainError ? (
                  <div className="p-4 text-sm text-destructive bg-destructive/10 rounded-md">
                    <div className="font-medium mb-1">Error</div>
                    <div className="font-mono text-xs">{explainError}</div>
                  </div>
                ) : explainResult ? (
                  <ExplainViewer plan={explainResult.plan} executionTimeMs={explainResult.executionTimeMs} />
                ) : null}
              </>
            ) : (
              <ResultsViewer result={result} error={error} loading={loading} />
            )}
          </div>
        </div>
      <QueryConfirmationDialog open={showConfirmation} onOpenChange={setShowConfirmation} query={pendingQuery || ""}
        onConfirm={() => { setShowConfirmation(false); executeQuery(pendingQuery!, true); setPendingQuery(null); }}
        onCancel={() => { setShowConfirmation(false); setPendingQuery(null); }} />
    </div>
  );
}
