"use client";
import { useState, useMemo, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { SchemaSelector } from "./SchemaSelector";
import { TableSearch } from "./TableSearch";
import { TableList } from "./TableList";
import type { Table } from "./types";
import type { SchemaInfo } from "@/lib/db/types";
import { invoke } from "@tauri-apps/api/core";

interface SchemaExplorerProps {
  connectionId?: string;
  onTableSelect?: (schema: string, table: string) => void;
  onOpenNewTableTab?: (schema: string) => void;
}

function SchemaExplorerLoadingState() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2"><Skeleton className="h-8 w-full" /></div>
      <div className="space-y-1">{Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-2"><Skeleton className="h-4 w-4 rounded" /><Skeleton className="h-4 flex-1" /></div>
      ))}</div>
    </div>
  );
}

export function SchemaExplorer({ connectionId, onTableSelect, onOpenNewTableTab }: SchemaExplorerProps) {
  const [tableSearchTerm, setTableSearchTerm] = useState("");
  const [selectedSchema, setSelectedSchema] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [schemasLoading, setSchemasLoading] = useState(false);
  const [tablesLoading, setTablesLoading] = useState(false);

  const loadSchemas = useCallback(async () => {
    if (!connectionId) return;
    setSchemasLoading(true);
    try {
      const result = await invoke<SchemaInfo[]>("get_schemas", { connectionId });
      const names = result.map(s => s.schemaName);
      setSchemas(names);
      if (names.length > 0 && !selectedSchema) setSelectedSchema(names[0]);
    } catch (e) { console.error("Failed to load schemas", e); }
    setSchemasLoading(false);
  }, [connectionId, selectedSchema]);

  const loadTables = useCallback(async () => {
    if (!connectionId || !selectedSchema) return;
    setTablesLoading(true);
    try {
      const result = await invoke<any[]>("get_tables", { connectionId, schema: selectedSchema });
      setTables(result.map(t => ({ schema: t.schemaName, name: t.tableName, rowCount: t.rowCount })));
    } catch (e) { console.error("Failed to load tables", e); }
    setTablesLoading(false);
  }, [connectionId, selectedSchema]);

  useEffect(() => { loadSchemas(); }, [loadSchemas]);
  useEffect(() => { loadTables(); }, [loadTables]);

  if (!connectionId) return <div className="p-4 text-sm text-muted-foreground">Connect to a database to view schemas</div>;
  if (schemasLoading && schemas.length === 0) return <SchemaExplorerLoadingState />;

  return (
    <div className="space-y-2">
      <div className="px-2 space-y-2">
        <SchemaSelector schemas={schemas} selectedSchema={selectedSchema} onSchemaSelect={setSelectedSchema} onCreateSchema={() => {}} />
        <TableSearch value={tableSearchTerm} onChange={setTableSearchTerm} />
      </div>
      <div className="space-y-1">
        {selectedSchema ? (
          <TableList tables={tables} isLoading={tablesLoading} tableSearchTerm={tableSearchTerm} selectedSchema={selectedSchema}
            onRefresh={loadTables} onTableSelect={onTableSelect!} onOpenNewTableTab={onOpenNewTableTab} />
        ) : schemas.length === 0 && !schemasLoading ? (
          <div className="px-2 py-1 text-sm text-muted-foreground">No schemas found</div>
        ) : null}
      </div>
    </div>
  );
}
