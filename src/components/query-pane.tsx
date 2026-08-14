"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { SQLEditor } from "@/components/sql-editor";
import { ResultsViewer } from "@/components/results-viewer";
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

interface QueryPaneTransient {
  result: QueryResult | null;
  error: string | null;
  loading: boolean;
  safeMode: boolean;
  showConfirmation: boolean;
  pendingQuery: string | null;
  explainResult: ExplainResult | null;
  explainError: string | null;
  explainLoading: boolean;
  analyze: boolean;
}

// Preserves transient run/explain state per query tab across tab switches.
const transientStore = new Map<string, QueryPaneTransient>();

export function clearQueryTransient(tabId: string) {
  transientStore.delete(tabId);
}

function initialTransient(connectionId: string): QueryPaneTransient {
  return {
    result: null,
    error: null,
    loading: false,
    safeMode: Persistence.getSafeMode(connectionId),
    showConfirmation: false,
    pendingQuery: null,
    explainResult: null,
    explainError: null,
    explainLoading: false,
    analyze: false,
  };
}

interface QueryPaneProps {
  connectionId: string;
  tab: { id: string; label: string; query: string };
  onQueryChange: (query: string) => void;
  onNewTab: () => void;
}

export function QueryPane({ connectionId, tab, onQueryChange, onNewTab }: QueryPaneProps) {
  const [transient, setTransient] = useState<QueryPaneTransient>(() => transientStore.get(tab.id) || initialTransient(connectionId));
  const t = transient;
  const containerRef = useRef<HTMLDivElement>(null);
  const [resultsHeight, setResultsHeight] = useState(() => Persistence.getQueryResultsHeight());
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    transientStore.set(tab.id, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, t]);

  useEffect(() => {
    Persistence.setQueryResultsHeight(resultsHeight);
  }, [resultsHeight]);

  const onDividerPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setDragging(true);
    const onMove = (ev: PointerEvent) => {
      const maxH = rect.height - 120;
      const next = Math.min(Math.max(rect.bottom - ev.clientY, 80), maxH);
      setResultsHeight(next);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  const schemasQuery = useSchemas(connectionId);
  const schemas = (schemasQuery.data || []).map(s => s.schemaName);

  const currentQuery = tab.query;

  const clearExplain = () => {
    setTransient(p => ({ ...p, explainResult: null, explainError: null, explainLoading: false }));
  };

  const executeQuery = async (q?: string, confirmed = false) => {
    const query = q || currentQuery;
    if (!query.trim()) return;
    setTransient(p => ({ ...p, loading: true, error: null, result: null, explainResult: null, explainError: null }));
    try {
      const res = await invoke<QueryResult>("execute_query", {
        connectionId,
        query,
        options: {
          confirmDestructive: t.safeMode ? confirmed : true,
          readOnly: false,
        },
      });
      setTransient(p => ({ ...p, result: res }));
      Persistence.addQueryToHistory(connectionId, query);
    } catch (e: any) {
      setTransient(p => ({ ...p, error: String(e) }));
    }
    setTransient(p => ({ ...p, loading: false }));
  };

  const runExplain = async () => {
    if (!currentQuery.trim()) return;
    setTransient(p => ({ ...p, explainLoading: true, explainError: null, explainResult: null, result: null, error: null }));
    try {
      const res = await API.explainQuery(connectionId, currentQuery, t.analyze);
      setTransient(p => ({ ...p, explainResult: res }));
    } catch (e: any) {
      setTransient(p => ({ ...p, explainError: String(e) }));
    }
    setTransient(p => ({ ...p, explainLoading: false }));
  };

  const handleExecute = () => {
    if (t.safeMode && isDestructiveQuery(currentQuery)) {
      setTransient(p => ({ ...p, pendingQuery: currentQuery, showConfirmation: true }));
      return;
    }
    executeQuery();
  };

  const showingExplain = t.explainResult !== null || t.explainError !== null || t.explainLoading;

  return (
    <div ref={containerRef} className="flex flex-col flex-1 min-h-0">
      <div className="h-12 border-b border-border flex items-center gap-2 px-4 shrink-0 overflow-x-auto">
        <Button size="sm" onClick={handleExecute} disabled={t.loading || !currentQuery.trim()}>
          {t.loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          Run Query
          <span className="ml-1.5 hidden rounded border border-white/30 px-1.5 py-0.5 text-[10px] font-normal leading-none opacity-80 md:inline">Ctrl/⌘ + Enter</span>
        </Button>
        <div className="flex-1" />
        <QueryHistory connectionId={connectionId} onSelect={onQueryChange} />
        <Button variant="outline" size="sm" onClick={runExplain} disabled={t.explainLoading || !currentQuery.trim()} title="EXPLAIN (FORMAT JSON) the current query">
          {t.explainLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-2" />}
          Explain
        </Button>
        <Button variant={t.analyze ? "default" : "outline"} size="sm" onClick={() => setTransient(p => ({ ...p, analyze: !p.analyze }))}
          className={cn(t.analyze && "bg-green-600 hover:bg-green-700")} title="Run EXPLAIN ANALYZE (executes the query — read-only queries only)">
          Analyze
        </Button>
        <SafeModeToggle enabled={t.safeMode} onToggle={enabled => { setTransient(p => ({ ...p, safeMode: enabled })); Persistence.setSafeMode(connectionId, enabled); }} />
        <Button variant="ghost" size="sm" onClick={onNewTab}><Plus className="h-4 w-4" /></Button>
      </div>
      <div className="flex-1 min-h-0">
        <SQLEditor value={currentQuery} onChange={onQueryChange} onExecute={handleExecute}
          connectionId={connectionId} schemas={schemas}
          getTables={schema => API.getTables(connectionId, schema).then(ts => ts.map(t => t.tableName))}
          getColumns={(schema, table) => API.getColumns(connectionId, schema, table).then(cs => cs.map(c => c.columnName))} />
      </div>
      <div
        onPointerDown={onDividerPointerDown}
        className={cn("h-1.5 shrink-0 cursor-row-resize border-t border-border transition-colors select-none",
          dragging ? "bg-primary/70" : "hover:bg-primary/50")}
        title="Drag to resize"
      />
      <div style={{ height: resultsHeight }} className="shrink-0 overflow-hidden">
        {showingExplain ? (
          <>
            <div className="flex h-8 items-center gap-2 border-b border-border bg-muted/20 px-3">
              <span className="text-xs text-muted-foreground">
                {t.explainLoading ? "Running EXPLAIN…" : t.analyze ? "EXPLAIN ANALYZE" : "EXPLAIN"}
              </span>
              <div className="flex-1" />
              <button onClick={clearExplain} className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground" title="Back to results">
                <X className="h-3 w-3" /> Close
              </button>
            </div>
            {t.explainLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Running EXPLAIN…
              </div>
            ) : t.explainError ? (
              <div className="p-4 text-sm text-destructive bg-destructive/10 rounded-md">
                <div className="font-medium mb-1">Error</div>
                <div className="font-mono text-xs">{t.explainError}</div>
              </div>
            ) : t.explainResult ? (
              <ExplainViewer plan={t.explainResult.plan} executionTimeMs={t.explainResult.executionTimeMs} />
            ) : null}
          </>
        ) : (
          <ResultsViewer result={t.result} error={t.error} loading={t.loading} />
        )}
      </div>
      <QueryConfirmationDialog open={t.showConfirmation} onOpenChange={open => setTransient(p => ({ ...p, showConfirmation: open }))} query={t.pendingQuery || ""}
        onConfirm={() => { setTransient(p => ({ ...p, showConfirmation: false })); executeQuery(t.pendingQuery!, true); setTransient(p => ({ ...p, pendingQuery: null })); }}
        onCancel={() => { setTransient(p => ({ ...p, showConfirmation: false, pendingQuery: null })); }} />
    </div>
  );
}
