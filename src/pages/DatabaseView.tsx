"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { DatabaseNavbar } from "@/components/database-navbar";
import { DbTabs } from "@/components/db-tabs";
import { TableEditor } from "@/components/table-editor";
import { ResultsViewer } from "@/components/results-viewer";
import { QueryPane } from "@/components/query-pane";
import SchemaVisualizer from "@/components/schema-visualizer";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Persistence } from "@/lib/persistence";
import API from "@/lib/ipc-client";
import type { QueryResult, ColumnInfo } from "@/lib/db/types";
import { generateTabId, type WorkspaceTab } from "@/lib/workspace-tabs";
import { clearQueryTransient } from "@/components/query-pane";
import { RefreshCw, Loader2, Plus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000];

export default function DatabaseView() {
  const { connection: connectionId } = useParams<{ connection: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [pageSizePopoverOpen, setPageSizePopoverOpen] = useState(false);
  const [pkColumns, setPkColumns] = useState<Record<string, string[]>>({});
  const [columnsMeta, setColumnsMeta] = useState<Record<string, ColumnInfo[]>>({});
  const [readOnly, setReadOnly] = useState(false);
  const [autoRefreshMs, setAutoRefreshMs] = useState<number | null>(null);
  const [autoRefreshOpen, setAutoRefreshOpen] = useState(false);

  const activeTab = tabs.find(t => t.id === activeTabId);

  // Schedule auto-refresh for the active table when enabled.
  useEffect(() => {
    if (!autoRefreshMs || !activeTab || activeTab.kind !== "table") return;
    const id = setInterval(() => fetchDataRef.current(true), autoRefreshMs);
    return () => clearInterval(id);
  }, [autoRefreshMs, activeTab, connectionId]);

  useEffect(() => {
    if (!connectionId) return;
    API.getConnectionInfo(connectionId)
      .then(info => setReadOnly(!!info.readOnly))
      .catch(() => setReadOnly(false));
  }, [connectionId]);

  // Load persisted workspace tabs (migrates legacy table/query tab storage).
  useEffect(() => {
    if (!connectionId) return;
    const saved = Persistence.getWorkspaceTabs(connectionId);
    const list: WorkspaceTab[] = (saved && saved.length > 0 ? saved : []).filter((t: any) => t.kind !== "tables");
    setTabs(list);
    const active = Persistence.getActiveWorkspaceTabId(connectionId);
    setActiveTabId(active && list.find(t => t.id === active) ? active : list[0]?.id || null);
  }, [connectionId]);

  useEffect(() => {
    if (connectionId) Persistence.setWorkspaceTabs(connectionId, tabs);
  }, [connectionId, tabs]);

  useEffect(() => {
    if (connectionId && activeTabId) Persistence.setActiveWorkspaceTabId(connectionId, activeTabId);
  }, [connectionId, activeTabId]);

  const openTable = useCallback((schema: string, table: string) => {
    const tabId = `${schema}.${table}`;
    setTabs(prev => {
      if (prev.find(t => t.id === tabId)) { setActiveTabId(tabId); return prev; }
      const newTab: WorkspaceTab = { kind: "table", id: tabId, schema, table, label: `${schema}.${table}` };
      setActiveTabId(tabId);
      setPage(1);
      return [...prev, newTab];
    });
  }, []);

  const openCreateTab = useCallback((schema: string) => {
    const tabId = `__create_${schema}_${Date.now()}`;
    const newTab: WorkspaceTab = { kind: "create", id: tabId, schema, table: "", label: "New Table" };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
  }, []);

  const openEditTab = useCallback((schema: string, table: string) => {
    const tabId = `__edit_${schema}.${table}`;
    setTabs(prev => {
      const existing = prev.find(t => t.id === tabId);
      if (existing) { setActiveTabId(tabId); return prev; }
      const newTab: WorkspaceTab = { kind: "edit", id: tabId, schema, table, label: `Edit ${schema}.${table}` };
      setActiveTabId(tabId);
      return [...prev, newTab];
    });
  }, []);

  const openQueryTab = useCallback((initialQuery?: string) => {
    const id = generateTabId();
    setTabs(prev => {
      const count = prev.filter(t => t.kind === "query").length + 1;
      const newTab: WorkspaceTab = { kind: "query", id, label: `Query ${count}`, query: initialQuery ?? "SELECT 1;" };
      setActiveTabId(id);
      return [...prev, newTab];
    });
  }, []);

  const openVisualizerTab = useCallback(() => {
    setTabs(prev => {
      const existing = prev.find(t => t.kind === "visualizer");
      if (existing) { setActiveTabId(existing.id); return prev; }
      const newTab: WorkspaceTab = { kind: "visualizer", id: generateTabId(), label: "Schema Visualizer" };
      setActiveTabId(newTab.id);
      return [...prev, newTab];
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    clearQueryTransient(tabId);
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      const newTabs = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId) {
        const next = newTabs[idx] || newTabs[idx - 1] || null;
        setActiveTabId(next?.id || null);
      }
      return newTabs;
    });
  }, [activeTabId]);

  const renameTab = useCallback((tabId: string, newLabel: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, label: newLabel } : t));
  }, []);

  const updateQueryTab = useCallback((tabId: string, newQuery: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, query: newQuery } : t));
  }, []);

  // Deep links / sidebar actions: open the right kind of tab and normalize the URL.
  useEffect(() => {
    if (!connectionId) return;
    const path = location.pathname;
    const queryTable = searchParams.get("queryTable");
    const tableParam = searchParams.get("table");
    const newTableSchema = searchParams.get("newTable");
    const editTableParam = searchParams.get("editTable");

    if (queryTable) {
      const [schema, table] = queryTable.split(".");
      if (schema && table) openQueryTab(`SELECT * FROM "${schema}"."${table}" LIMIT 100;`);
    } else if (path.endsWith("/query")) {
      openQueryTab();
    } else if (path.endsWith("/visualizer")) {
      openVisualizerTab();
    } else if (newTableSchema) {
      openCreateTab(newTableSchema);
    } else if (editTableParam) {
      const [schema, table] = editTableParam.split(".");
      if (schema && table) openEditTab(schema, table);
    } else if (tableParam) {
      const [schema, table] = tableParam.split(".");
      if (schema && table) openTable(schema, table);
    } else if (path.includes("/table/")) {
      const parts = path.split("/");
      const tIdx = parts.findIndex(p => p === "table");
      const table = tIdx >= 0 ? parts[tIdx + 1] : undefined;
      const schema = searchParams.get("schema") || "public";
      if (table) openTable(schema, table);
    }

    if (path !== `/db/${connectionId}` || searchParams.size > 0) {
      navigate(`/db/${connectionId}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, searchParams, location.pathname, openTable, openCreateTab, openEditTab, openQueryTab, openVisualizerTab]);

  useEffect(() => {
    if (!connectionId || !activeTab || activeTab.kind !== "table") return;
    if (columnsMeta[activeTab.id]) return;
    invoke<ColumnInfo[]>("get_columns", { connectionId, schema: activeTab.schema, table: activeTab.table })
      .then(cols => {
        setColumnsMeta(prev => ({ ...prev, [activeTab.id]: cols }));
        setPkColumns(prev => ({ ...prev, [activeTab.id]: cols.filter(c => c.isPrimaryKey).map(c => c.columnName) }));
      })
      .catch(console.error);
  }, [connectionId, activeTab, columnsMeta]);

  const fetchData = useCallback(async (silent = false) => {
    if (!connectionId || !activeTab || activeTab.kind !== "table") return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await API.getTableData(connectionId, activeTab.schema, activeTab.table, page, pageSize);
      setResult({
        columns: data.columns,
        rows: data.rows,
        rowCount: data.rows.length,
        affectedRows: undefined,
        isSelect: true,
        executionTimeMs: 0,
      });
      setTotalCount(data.totalCount);
    } catch (e: any) {
      if (!silent) {
        setError(String(e));
        setResult(null);
        setTotalCount(0);
      }
    }
    if (!silent) setLoading(false);
  }, [connectionId, activeTab, page, pageSize]);

  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 0;
  const activeView = activeTab?.kind === "query" ? "query" : activeTab?.kind === "visualizer" ? "visualizer" : "tables";

  const renderContent = () => {
    if (!activeTab) {
      const schemaName = searchParams.get("newTable") || "public";
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <p className="text-muted-foreground">No table selected</p>
            <p className="text-sm text-muted-foreground">Select a table from the schema explorer to view its data</p>
            <Button variant="outline" size="sm" onClick={() => openCreateTab(schemaName)}><Plus className="h-4 w-4 mr-1" />Create New Table</Button>
          </div>
        </div>
      );
    }

    if (activeTab.kind === "query") {
      return (
        <QueryPane
          key={activeTab.id}
          connectionId={connectionId || ""}
          tab={activeTab}
          onQueryChange={query => updateQueryTab(activeTab.id, query)}
          onNewTab={() => openQueryTab()}
        />
      );
    }

    if (activeTab.kind === "visualizer") {
      return (
        <div className="flex-1 min-h-0">
          {connectionId ? <SchemaVisualizer connectionId={connectionId} /> : null}
        </div>
      );
    }

    if (activeTab.kind === "create" || activeTab.kind === "edit") {
      return (
        <TableEditor
          mode={activeTab.kind === "create" ? "create" : "edit"}
          schema={activeTab.schema}
          table={activeTab.table || undefined}
          connectionId={connectionId || ""}
          onCreated={(s, t) => { closeTab(activeTab.id); openTable(s, t); }}
          onDone={() => closeTab(activeTab.id)}
        />
      );
    }

    // table tab
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-auto min-h-12 border-b border-border flex items-center justify-between px-6 py-2 shrink-0 bg-muted/20">
          <div className="flex items-center gap-3">
            <div id="table-actions-slot" />
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 px-1.5 gap-1 text-muted-foreground hover:text-foreground" disabled={loading} onClick={() => fetchData()}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin-burst" /> : <RefreshCw className="h-3.5 w-3.5" />}
                <span className="text-xs">Refresh</span>
              </Button>
              <Popover open={autoRefreshOpen} onOpenChange={setAutoRefreshOpen}>
                <PopoverTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors" title="Auto refresh">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-1" align="start">
                  <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">Auto refresh</div>
                  <button onClick={() => { setAutoRefreshMs(null); setAutoRefreshOpen(false); }}
                    className={cn("flex items-center justify-between w-full px-2 py-1 text-xs rounded hover:bg-accent", autoRefreshMs === null && "font-medium")}>
                    <span>Off</span>
                    {autoRefreshMs === null && <Check className="h-3 w-3 shrink-0" />}
                  </button>
                  {[{ label: "5 seconds", ms: 5000 }, { label: "10 seconds", ms: 10000 }, { label: "30 seconds", ms: 30000 }, { label: "1 minute", ms: 60000 }, { label: "5 minutes", ms: 300000 }].map(opt => (
                    <button key={opt.ms} onClick={() => { setAutoRefreshMs(opt.ms); setAutoRefreshOpen(false); }}
                      className={cn("flex items-center justify-between w-full px-2 py-1 text-xs rounded hover:bg-accent", autoRefreshMs === opt.ms && "font-medium")}>
                      <span>{opt.label}</span>
                      {autoRefreshMs === opt.ms && <Check className="h-3 w-3 shrink-0" />}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
            {result && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Popover open={pageSizePopoverOpen} onOpenChange={setPageSizePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                      {pageSize} <ChevronRight className="h-3 w-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-24 p-1" align="start">
                    {PAGE_SIZE_OPTIONS.map(size => (
                      <button key={size} onClick={() => { setPageSize(size); setPage(1); setPageSizePopoverOpen(false); }}
                        className={cn("flex items-center gap-2 w-full px-2 py-1 text-xs rounded hover:bg-accent", pageSize === size && "font-medium")}>
                        {pageSize === size && <Check className="h-3 w-3" />}
                        {size}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                <span className={cn(totalCount >= 10000 && "text-yellow-500")}>
                  {totalCount >= 10000 ? "10000+" : totalCount} rows
                </span>
                <div id="export-slot" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {totalPages > 0 && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground mr-2">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(1)}><ChevronsLeft className="h-3 w-3" /></Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-3 w-3" /></Button>
                <span className="px-2 text-xs">{page} / {totalPages}</span>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-3 w-3" /></Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(totalPages)}><ChevronsRight className="h-3 w-3" /></Button>
              </div>
            )}
            <div id="review-changes-slot" />
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ResultsViewer result={result} error={error} loading={loading}
            schema={activeTab.schema} table={activeTab.table}
            onRefresh={() => fetchData()}
            connectionId={connectionId} pkColumns={pkColumns[activeTab.id] || []}
            columnsMeta={columnsMeta[activeTab.id]}
            enableCRUD={true} readOnly={readOnly}
            onAddColumn={() => openEditTab(activeTab.schema, activeTab.table)} />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <DatabaseNavbar connectionId={connectionId || ""} activeView={activeView}
        onOpenQuery={() => openQueryTab()} onOpenVisualizer={openVisualizerTab} />
      <DbTabs tabs={tabs} activeTabId={activeTabId} onTabSelect={setActiveTabId} onTabClose={closeTab} onTabRename={renameTab} />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
