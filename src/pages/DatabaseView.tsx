"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/main-layout";
import { DatabaseNavbar } from "@/components/database-navbar";
import { ResultsViewer } from "@/components/results-viewer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { getConnection } from "@/lib/connections/store";
import type { ConnectionConfig, QueryResult } from "@/lib/db/types";
import { RefreshCw, Loader2, Plus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface TableTab {
  id: string;
  schema: string;
  table: string;
  label: string;
}

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

  const activeTab = tableTabs.find(t => t.id === activeTabId);

  useEffect(() => {
    if (connectionId) {
      const conn = getConnection(connectionId);
      if (conn) setConnection(conn);
    }
  }, [connectionId]);

  const openTable = useCallback((schema: string, table: string) => {
    const tabId = `${schema}.${table}`;
    setTableTabs(prev => {
      if (prev.find(t => t.id === tabId)) {
        setActiveTabId(tabId);
        return prev;
      }
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
        const next = newTabs[idx] || newTabs[idx - 1] || null;
        setActiveTabId(next?.id || null);
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

  return (
    <MainLayout>
      <div className="flex flex-col h-full">
        <DatabaseNavbar connectionId={connectionId || ""} />
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">
            {tableTabs.length > 0 && (
              <div className="border-b border-border px-4 flex items-center gap-1 h-10 shrink-0 bg-muted/10">
                <Tabs value={activeTabId || ""} onValueChange={setActiveTabId} className="flex items-center h-full">
                  <TabsList className="h-8">
                    {tableTabs.map(tab => (
                      <TabsTrigger key={tab.id} value={tab.id} className="text-xs h-7 px-3">
                        {tab.label}
                        <button onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} className="ml-2 hover:text-foreground text-muted-foreground">&times;</button>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            )}
            {activeTab ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="h-auto min-h-12 border-b border-border flex items-center justify-between px-6 py-2 shrink-0 bg-muted/20">
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" disabled={loading} onClick={fetchData}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
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
                <div className="text-center">
                  <p className="text-muted-foreground mb-4">No table selected</p>
                  <p className="text-sm text-muted-foreground">Select a table from the schema explorer to view its data</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
