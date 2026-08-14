"use client";
import * as React from "react";
import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Table2, Eye, Layers, Loader2, Plus, RefreshCw, ShieldAlert, ChevronRight, ChevronDown, MoreVertical, FileCode2, ClipboardCopy, Pencil, CopyPlus, Download, Eraser, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/results-viewer/confirm-dialog";
import { toCsv, toJson, downloadText } from "@/lib/export";
import type { Table } from "./types";
import type { ColumnInfo } from "@/lib/ipc-client";

interface TableListProps {
  tables: Table[];
  isLoading?: boolean;
  tableSearchTerm?: string;
  connectionId?: string;
  onRefresh?: () => void;
  onTableSelect: (schema: string, table: string) => void;
  onOpenNewTableTab?: (schema: string) => void;
  selectedSchema?: string;
}

function tableKind(table: Table): { icon: typeof Table2; label: string } {
  const type = (table.tableType || "TABLE").toUpperCase();
  if (type.includes("MATERIALIZED")) return { icon: Layers, label: "Materialized view" };
  if (type.includes("VIEW")) return { icon: Eye, label: "View" };
  if (type.includes("PARTITIONED")) return { icon: Table2, label: "Partitioned table" };
  return { icon: Table2, label: "Table" };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Build a CREATE TABLE DDL from column metadata. */
function buildTableSchemaDDL(schema: string, table: string, columns: ColumnInfo[]): string {
  const lines = columns.map(c => {
    const parts = [quoteIdent(c.columnName), c.dataType];
    if (c.isPrimaryKey) parts.push("PRIMARY KEY");
    else if (!c.isNullable) parts.push("NOT NULL");
    if (c.defaultValue) parts.push(`DEFAULT ${c.defaultValue}`);
    return `  ${parts.join(" ")}`;
  });
  return `CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(table)} (\n${lines.join(",\n")}\n);`;
}

/** Build INSERT statements from exported rows. */
function toSqlInserts(schema: string, table: string, columns: { name: string; dataType: string }[], rows: Record<string, unknown>[]): string {
  const q = (v: unknown): string => {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  const cols = columns.map(c => quoteIdent(c.name)).join(", ");
  return rows.map(row => {
    const vals = columns.map(c => q(row[c.name])).join(", ");
    return `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(table)} (${cols}) VALUES (${vals});`;
  }).join("\n");
}

export function TableList({ tables, isLoading, tableSearchTerm, connectionId, onRefresh, onTableSelect, onOpenNewTableTab, selectedSchema }: TableListProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [columns, setColumns] = useState<Record<string, ColumnInfo[]>>({});
  const [columnsLoading, setColumnsLoading] = useState<Record<string, boolean>>({});
  const [menuTable, setMenuTable] = useState<Table | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateName, setDuplicateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | { kind: "empty" | "delete"; table: Table }>(null);

  const filteredTables = tableSearchTerm?.trim()
    ? tables.filter(t => t.name.toLowerCase().includes(tableSearchTerm.toLowerCase()))
    : tables;

  const toggleExpand = useCallback(async (table: Table) => {
    const key = `${table.schema}.${table.name}`;
    const next = !expanded[key];
    setExpanded(prev => ({ ...prev, [key]: next }));
    if (next && !columns[key] && connectionId && !columnsLoading[key]) {
      setColumnsLoading(prev => ({ ...prev, [key]: true }));
      try {
        const cols = await invoke<ColumnInfo[]>("get_columns", { connectionId, schema: table.schema, table: table.name });
        setColumns(prev => ({ ...prev, [key]: cols || [] }));
      } catch (e) {
        toast.error("Failed to load columns", { description: String(e) });
      } finally {
        setColumnsLoading(prev => ({ ...prev, [key]: false }));
      }
    }
  }, [expanded, columns, columnsLoading, connectionId]);

  const openInEditor = (table: Table) => {
    if (!connectionId) return;
    navigate(`/db/${connectionId}/query?table=${table.schema}.${table.name}`);
  };

  const copySchema = async (table: Table) => {
    if (!connectionId) return;
    try {
      const cols = await invoke<ColumnInfo[]>("get_columns", { connectionId, schema: table.schema, table: table.name });
      await navigator.clipboard.writeText(buildTableSchemaDDL(table.schema, table.name, cols));
      toast.success("Table schema copied");
    } catch (e) {
      toast.error("Failed to copy schema", { description: String(e) });
    }
  };

  const editTable = (table: Table) => {
    if (!connectionId) return;
    navigate(`/db/${connectionId}?editTable=${table.schema}.${table.name}`);
  };

  const duplicateTable = async () => {
    if (!menuTable || !connectionId) return;
    const name = duplicateName.trim();
    if (!name) { toast.error("Table name is required"); return; }
    setBusy(true);
    try {
      await invoke("execute_query", {
        connectionId,
        query: `CREATE TABLE ${quoteIdent(menuTable.schema)}.${quoteIdent(name)} (LIKE ${quoteIdent(menuTable.schema)}.${quoteIdent(menuTable.name)} INCLUDING ALL);`,
        options: { confirmDestructive: true, readOnly: false },
      });
      toast.success(`Table "${name}" duplicated`);
      setDuplicateOpen(false);
      setDuplicateName("");
      onRefresh?.();
    } catch (e) {
      toast.error("Duplicate failed", { description: String(e) });
    }
    setBusy(false);
  };

  const exportData = async (format: "csv" | "json" | "sql") => {
    if (!menuTable || !connectionId) return;
    setBusy(true);
    try {
      // Fetch all rows (bounded at 100k).
      const data = await invoke<any>("get_table_data", { connectionId, schema: menuTable.schema, table: menuTable.name, page: 1, pageSize: 100000 });
      const result = { columns: (data.columns || []) as { name: string; dataType: string }[], rows: (data.rows || []) as Record<string, unknown>[] };
      const base = `${menuTable.schema}.${menuTable.name}`;
      if (format === "csv") downloadText(`${base}.csv`, toCsv(result), "text/csv");
      else if (format === "json") downloadText(`${base}.json`, toJson(result), "application/json");
      else downloadText(`${base}.sql`, toSqlInserts(menuTable.schema, menuTable.name, result.columns, result.rows), "application/sql");
      toast.success(`Exported ${result.rows.length} rows as ${format.toUpperCase()}`);
    } catch (e) {
      toast.error("Export failed", { description: String(e) });
    }
    setBusy(false);
  };

  const runConfirmAction = async () => {
    if (!confirmAction || !connectionId) return;
    const { kind, table } = confirmAction;
    setBusy(true);
    try {
      const sql = kind === "empty"
        ? `TRUNCATE TABLE ${quoteIdent(table.schema)}.${quoteIdent(table.name)};`
        : `DROP TABLE ${quoteIdent(table.schema)}.${quoteIdent(table.name)};`;
      await invoke("execute_query", { connectionId, query: sql, options: { confirmDestructive: true, readOnly: false } });
      toast.success(kind === "empty" ? `Table "${table.name}" emptied` : `Table "${table.name}" deleted`);
      if (kind === "delete") onRefresh?.();
      setConfirmAction(null);
    } catch (e) {
      toast.error(kind === "empty" ? "Empty failed" : "Delete failed", { description: String(e) });
    }
    setBusy(false);
  };

  /** Shared actions used by both the ⋮ dropdown and the right-click context menu. */
  const renderTableMenuItems = (
    table: Table,
    menu: {
      Item: typeof DropdownMenuItem;
      Separator: typeof DropdownMenuSeparator;
      Sub: typeof DropdownMenuSub;
      SubTrigger: typeof DropdownMenuSubTrigger;
      SubContent: typeof DropdownMenuSubContent;
      Portal: typeof DropdownMenuPortal;
    }
  ) => (
    <>
      <menu.Item onClick={() => openInEditor(table)}><FileCode2 className="h-4 w-4 mr-2" />Open in SQL editor</menu.Item>
      <menu.Item onClick={() => copySchema(table)}><ClipboardCopy className="h-4 w-4 mr-2" />Copy table schema</menu.Item>
      <menu.Item onClick={() => editTable(table)}><Pencil className="h-4 w-4 mr-2" />Edit table</menu.Item>
      <menu.Item onClick={() => { setMenuTable(table); setDuplicateName(`${table.name}_copy`); setDuplicateOpen(true); }}><CopyPlus className="h-4 w-4 mr-2" />Duplicate table</menu.Item>
      <menu.Sub>
        <menu.SubTrigger><Download className="h-4 w-4 mr-2" />Export data</menu.SubTrigger>
        <menu.Portal>
          <menu.SubContent>
            <menu.Item onClick={() => { setMenuTable(table); exportData("csv"); }}>CSV</menu.Item>
            <menu.Item onClick={() => { setMenuTable(table); exportData("json"); }}>JSON</menu.Item>
            <menu.Item onClick={() => { setMenuTable(table); exportData("sql"); }}>SQL</menu.Item>
          </menu.SubContent>
        </menu.Portal>
      </menu.Sub>
      <menu.Separator />
      <menu.Item className="text-destructive focus:text-destructive" onClick={() => setConfirmAction({ kind: "empty", table })}><Eraser className="h-4 w-4 mr-2" />Empty table</menu.Item>
      <menu.Item className="text-destructive focus:text-destructive" onClick={() => setConfirmAction({ kind: "delete", table })}><Trash2 className="h-4 w-4 mr-2" />Delete table</menu.Item>
    </>
  );

  const dropdownMenu = {
    Item: DropdownMenuItem,
    Separator: DropdownMenuSeparator,
    Sub: DropdownMenuSub,
    SubTrigger: DropdownMenuSubTrigger,
    SubContent: DropdownMenuSubContent,
    Portal: DropdownMenuPortal,
  };

  const contextMenu = {
    Item: ContextMenuItem,
    Separator: ContextMenuSeparator,
    Sub: ContextMenuSub,
    SubTrigger: ContextMenuSubTrigger,
    SubContent: ContextMenuSubContent,
    Portal: React.Fragment as unknown as typeof DropdownMenuPortal,
  };

  return (
    <div className="space-y-1">
      {selectedSchema && (
        <div className="flex items-center justify-between px-2 py-2 mb-2">
          <div className="text-xs font-semibold text-muted-foreground tracking-wide capitalize">Tables</div>
          <div className="flex items-center gap-1">
            {onRefresh && (
              <TooltipProvider delayDuration={400}><Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className={cn("h-6 w-6 opacity-70", isLoading && "text-muted-foreground opacity-40")} disabled={isLoading} onClick={onRefresh}>
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right"><p>Refresh tables</p></TooltipContent>
              </Tooltip></TooltipProvider>
            )}
            {onOpenNewTableTab && (
              <TooltipProvider delayDuration={400}><Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 opacity-70" onClick={() => onOpenNewTableTab(selectedSchema || "public")}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right"><p>New table</p></TooltipContent>
              </Tooltip></TooltipProvider>
            )}
          </div>
        </div>
      )}
      {filteredTables.length === 0 ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">
          {tableSearchTerm ? "No tables found" : "No tables"}
        </div>
      ) : (
        <div className="space-y-0.5">
          {filteredTables.map((table) => {
            const key = `${table.schema}.${table.name}`;
            const isOpen = !!expanded[key];
            const { icon: KindIcon, label: kindLabel } = tableKind(table);
            const cols = columns[key];
            return (
              <div key={key}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className="group flex items-center w-full">
                      <button onClick={() => toggleExpand(table)}
                        className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={isOpen ? "Collapse columns" : "Expand columns"}>
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                      <TooltipProvider delayDuration={600}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="shrink-0 flex items-center">
                              <KindIcon className="h-4 w-4" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right"><p>{kindLabel}</p></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <button onClick={() => onTableSelect(table.schema, table.name)}
                        className="flex-1 flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-sm hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground text-left min-w-0">
                        <span className="flex-1 text-left truncate">{table.name}</span>
                        {table.hasRls && (
                          <TooltipProvider delayDuration={600}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="shrink-0 flex items-center">
                                  <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="right"><p>Row Level Security enabled</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={`Actions for ${table.name}`}>
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {renderTableMenuItems(table, dropdownMenu)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-52">
                    {renderTableMenuItems(table, contextMenu)}
                  </ContextMenuContent>
                </ContextMenu>
                {isOpen && (
                  <div className="ml-6 pl-3 border-l border-border/60 space-y-0.5 py-0.5">
                    {columnsLoading[key] ? (
                      <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Loading columns…</div>
                    ) : cols ? (
                      cols.length > 0 ? cols.map(c => (
                        <div key={c.columnName} className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground">
                          <span className="font-mono truncate">{c.columnName}</span>
                          <span className="text-muted-foreground/60 shrink-0">{c.dataType}</span>
                          {c.isPrimaryKey && <span className="text-amber-500/70 shrink-0">PK</span>}
                        </div>
                      )) : <div className="px-2 py-1 text-xs text-muted-foreground">No columns</div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicate table</DialogTitle>
            <DialogDescription>Create a copy of {menuTable?.schema}.{menuTable?.name} with a new name.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dup-name">New table name</Label>
            <Input id="dup-name" value={duplicateName} onChange={e => setDuplicateName(e.target.value)} placeholder="new_table_name" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={duplicateTable} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CopyPlus className="h-4 w-4 mr-2" />}
              Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={open => { if (!open) setConfirmAction(null); }}
        title={confirmAction?.kind === "empty" ? "Empty table" : "Delete table"}
        description={confirmAction
          ? `This will ${confirmAction.kind === "empty" ? "TRUNCATE (remove all rows from)" : "DROP (permanently delete)"} ${confirmAction.table.schema}.${confirmAction.table.name}. This cannot be undone.`
          : ""}
        confirmLabel={confirmAction?.kind === "empty" ? "Empty" : "Delete"}
        destructive
        loading={busy}
        onConfirm={runConfirmAction}
      />
    </div>
  );
}
