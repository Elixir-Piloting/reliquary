"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/main-layout";
import { DatabaseNavbar } from "@/components/database-navbar";
import { TableTabs, type TableTab } from "@/components/table-tabs";
import { CreateTableDialog } from "@/components/create-table-dialog";
import { ResultsViewer } from "@/components/results-viewer";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { getConnection } from "@/lib/connections/store";
import { Persistence } from "@/lib/persistence";
import type { ConnectionConfig, QueryResult } from "@/lib/db/types";
import { RefreshCw, Loader2, Plus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000];

function TableLoadingSkeleton() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0 bg-muted/20">
        <div><Skeleton className="h-5 w-32 mb-1" /><Skeleton className="h-3 w-16" /></div>
        <div className="flex items-center gap-2"><Skeleton className="h-8 w-20" /></div>
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="h-full flex flex-col">
          <div className="flex items-center gap-4 mx-6 mt-4">
            <Skeleton className="h-8 w-16" /><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-28" />
          </div>
          <div className="flex-1 mt-4 overflow-auto px-6 pb-6">
            <div className="bg-card rounded-lg border border-border p-4">
              <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => (<Skeleton key={i} className="h-8 w-full" />))}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DatabaseView() {
  const { connection: connectionId } = useParams<{ connection: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [connection, setConnection] = useState<ConnectionConfig | null>(null);
  const [tableTabs, setTableTabs] = useState<TableTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [pageSizePopoverOpen, setPageSizePopoverOpen] = useState(false);
  const [createTableOpen, setCreateTableOpen] = useState(false);

  const activeTab = tableTabs.find(t => t.id === activeTabId);

  useEffect(() => {
    if (connectionId) {
      const conn = getConnection(connectionId);
      if (conn) setConnection(conn);
    }
  }, [connectionId]);

  useEffect(() => {
    if (connectionId) Persistence.setTableTabs(connectionId, tableTabs);
  }, [connectionId, tableTabs]);

  useEffect(() => {
    if (connectionId && activeTabId) Persistence.setActiveTabId(connectionId, activeTabId);
  }, [connectionId, activeTabId]);

  useEffect(() => {
    if (!connectionId) return;
    const saved = Persistence.getTableTabs(connectionId);
    if (saved && saved.length > 0) {
      setTableTabs(saved);
      const active = Persistence.getActiveTabId(connectionId);
      setActiveTabId(active && saved.find(t => t.id === active) ? active : saved[0].id);
    }
  }, [connectionId]);

  const openTable = useCallback((schema: string, table: string) => {
    const tabId = `${schema}.${table}`;
    setTableTabs(prev => {
      if (prev.find(t => t.id === tabId)) { setActiveTabId(tabId); return prev; }
      const newTab: TableTab = { id: tabId, schema, table, label: `${schema}.${table}` };
      setActiveTabId(tabId);
      setPage(1);
      return [...prev, newTab];
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTableTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId) {
        const idx = prev.findIndex(t => t.id === tabId);
        setActiveTabId((newTabs[idx] || newTabs[idx - 1] || null)?.id || null);
      }
      return newTabs;
    });
  }, [activeTabId]);

  useEffect(() => {
    const tableParam = searchParams.get("table");
    if (tableParam) {
      const [schema, table] = tableParam.split(".");
      if (schema && table) openTable(schema, table);
    }
  }, [searchParams, openTable]);

  const fetchData = useCallback(async () => {
    if (!connectionId || !activeTab) return;
    setLoading(true);
    setError(null);
    try {
      const offset = (page - 1) * pageSize;
      const result = await invoke<QueryResult>("execute_query", {
        connectionId,
        query: `SELECT * FROM "${activeTab.schema}"."${activeTab.table}" LIMIT ${pageSize} OFFSET ${offset}`,
      });
      setResult(result);
    } catch (e: any) {
      setError(String(e));
      setResult(null);
    }
    setLoading(false);
  }, [connectionId, activeTab, page, pageSize]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = result?.rowCount ? Math.ceil(result.rowCount / pageSize) : 0;
  const schemaName = activeTab?.schema || (searchParams.get("newTable") || "public");

  return (
    <MainLayout>
      <div className="flex flex-col h-full">
        <DatabaseNavbar connectionId={connectionId || ""} />
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">
            <TableTabs tabs={tableTabs} activeTabId={activeTabId} onTabSelect={setActiveTabId} onTabClose={closeTab} />
            {activeTab ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="h-auto min-h-12 border-b border-border flex items-center justify-between px-6 py-2 shrink-0 bg-muted/20">
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" disabled={loading} onClick={fetchData}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
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
                        <span className={cn(result.rowCount >= 10000 && "text-yellow-500")}>
                          {result.rowCount >= 10000 ? "10000+" : result.rowCount} rows
                        </span>
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
                    <Button variant="outline" size="sm" onClick={() => setCreateTableOpen(true)}><Plus className="h-4 w-4 mr-1" />New Table</Button>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden px-6 pb-6 pt-4">
                  <ResultsViewer result={result} error={error} loading={loading}
                    schema={activeTab.schema} table={activeTab.table}
                    onRefresh={fetchData} provider={connection?.provider} />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-4">
                  <p className="text-muted-foreground">No table selected</p>
                  <p className="text-sm text-muted-foreground">Select a table from the schema explorer to view its data</p>
                  <Button variant="outline" size="sm" onClick={() => setCreateTableOpen(true)}><Plus className="h-4 w-4 mr-1" />Create New Table</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <CreateTableDialog open={createTableOpen} onOpenChange={setCreateTableOpen} schema={schemaName}
        connectionId={connectionId || ""} onTableCreated={() => { setTableTabs([]); }} />
    </MainLayout>
  );
}
