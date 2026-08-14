"use client";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, Check, Copy, X, Plus, Trash2, FileDown, Download } from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import type { QueryResult, ResultsViewerProps, PendingChange } from "./types";
import { ReviewChangesSheet } from "./review-changes-sheet";
import { RowEditorPanel } from "./row-editor-panel";
import { ConfirmDialog } from "./confirm-dialog";
import { useRightSidebar } from "@/components/right-sidebar-context";
import { getInputType, formatValueForInput, toSqlParamValue, displayValueToString } from "./field-types";
import { toCsv, toJson, downloadText } from "@/lib/export";
import API, { type RowMutationStatement } from "@/lib/ipc-client";

function getSortOptions(dataType: string): { label: string; direction: 'asc' | 'desc' }[] {
  const dt = dataType?.toLowerCase() || '';
  if (dt === 'boolean' || dt === 'bool') return [
    { label: 'False first', direction: 'asc' },
    { label: 'True first', direction: 'desc' },
  ];
  if (dt.includes('date') || dt.includes('timestamp') || dt.includes('time')) return [
    { label: 'Newest first', direction: 'desc' },
    { label: 'Oldest first', direction: 'asc' },
  ];
  if (/^(int|float|numeric|decimal|serial|real|double|money)/.test(dt)) return [
    { label: 'Smallest first', direction: 'asc' },
    { label: 'Largest first', direction: 'desc' },
  ];
  return [
    { label: 'A → Z', direction: 'asc' },
    { label: 'Z → A', direction: 'desc' },
  ];
}

function InlineSelect({ value, options, labels, onChange, onSave, onCancel }: {
  value: string; options: string[]; labels?: string[];
  onChange: (v: string) => void; onSave: (v: string) => void; onCancel: () => void;
}) {
  const [open, setOpen] = useState(true);
  const btnRef = useRef<HTMLButtonElement>(null);
  const ddRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, maxHeight: 240 });

  const measure = useCallback(() => {
    const td = btnRef.current?.closest('td') as HTMLTableCellElement | null;
    if (!td) return;
    const r = td.getBoundingClientRect();
    const estHeight = Math.min(options.length * 30 + 4, 320);
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const showBelow = spaceBelow >= estHeight || spaceBelow >= spaceAbove;
    setPos({
      top: showBelow ? r.bottom + 1 : r.top - 1 - Math.min(estHeight, spaceAbove),
      left: r.left,
      width: r.width,
      maxHeight: showBelow ? Math.min(320, spaceBelow) : Math.min(320, spaceAbove),
    });
  }, [options.length]);

  useEffect(() => { if (open) measure(); }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || ddRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} autoFocus onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter') onSave(value); if (e.key === 'Escape') onCancel(); }}
        className="w-full text-left bg-transparent border-0 p-0 m-0 text-foreground cursor-pointer text-sm">
        {value === '' ? <span className="text-muted-foreground italic">NULL</span> : value}
      </button>
      {open && createPortal(
        <div ref={ddRef} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 99999, maxHeight: pos.maxHeight, overflowY: 'auto' }}
          className="bg-popover border border-border shadow-md text-sm rounded-none">
          {options.map((opt, i) => (
            <div key={opt} onMouseDown={(e) => { e.preventDefault(); onChange(opt); setOpen(false); onSave(opt); }}
              className={cn("px-2 py-1.5 cursor-pointer select-none transition-colors",
                opt === value ? "bg-primary/15 text-foreground font-medium" : "text-foreground hover:bg-accent hover:text-accent-foreground")}>
              {labels ? labels[i] : (opt === '' ? <span className="text-muted-foreground italic">NULL</span> : opt)}
            </div>
          ))}
        </div>, document.body)}
    </>
  );
}

function ResultsLoadingSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <Table><TableHeader className="sticky top-0 bg-card z-50"><TableRow>
          {Array.from({ length: 6 }).map((_, i) => (<TableHead key={i}><Skeleton className="h-4 w-20" /></TableHead>))}
        </TableRow></TableHeader><TableBody>
          {Array.from({ length: 10 }).map((_, rowIdx) => (<TableRow key={rowIdx}>
            {Array.from({ length: 6 }).map((_, colIdx) => (<TableCell key={colIdx}><Skeleton className="h-4 w-full" /></TableCell>))}
          </TableRow>))}
        </TableBody></Table>
      </div>
    </div>
  );
}

export function ResultsViewer({
  result, error, loading, schema, table, onRefresh, enableCRUD, readOnly, connectionId, pkColumns, columnsMeta, onAddColumn
}: ResultsViewerProps) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [sortDropdownCol, setSortDropdownCol] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [selectedCell, setSelectedCell] = useState<{ rowIdx: number; col: string } | null>(null);
  const [enumCache, setEnumCache] = useState<Record<string, string[] | null>>({});
  const [enumLoading, setEnumLoading] = useState<Record<string, boolean>>({});

  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [showReviewSheet, setShowReviewSheet] = useState(false);
  const [editor, setEditor] = useState<{ mode: 'edit' | 'insert'; row: Record<string, unknown> | null } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [localRows, setLocalRows] = useState<Record<string, unknown>[] | null>(null);
  const rightSidebar = useRightSidebar();

  const canEdit = enableCRUD && !readOnly && schema && table && pkColumns && pkColumns.length > 0 && connectionId;
  const displayResult = localRows ? { ...result, rows: localRows } : result;

  // Drive the top-level right sidebar content from the local editor state. The
  // panel is always mounted into `MainLayout`'s sidebar; this effect only swaps
  // its content (so clicking a cell can stage a row's form without opening the
  // sidebar). Opening is controlled by the insert action and the navbar toggle.
  useEffect(() => {
    if (!editor || !canEdit || !schema || !table || !connectionId) {
      rightSidebar.setContent(null);
      return;
    }
    rightSidebar.setContent(
      <RowEditorPanel
        open
        mode={editor.mode}
        connectionId={connectionId}
        schema={schema}
        table={table}
        columns={(columnsMeta && columnsMeta.length > 0 ? columnsMeta : (displayResult?.columns || []).map(c => ({
          columnName: c.name, dataType: c.dataType, isNullable: true, isPrimaryKey: pkColumns?.includes(c.name) || false, defaultValue: null,
        })))}
        pkColumns={pkColumns || []}
        row={editor.row}
        onClose={() => { rightSidebar.closeRight(); setEditor(null); }}
        onStageEdit={handleStageRowEdits}
        onStageInsert={handleInsertSubmit}
        onDeleteRow={handleDeleteRowFromEditor}
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, canEdit, schema, table, connectionId, columnsMeta, pkColumns]);

  const exportResult = useMemo(() => displayResult ? {
    columns: displayResult.columns || [],
    rows: displayResult.rows,
  } : null, [displayResult]);

  useEffect(() => { setLocalRows(null); setSelectedRows(new Set()); }, [result]);

  // Close the right sidebar if this grid unmounts while the editor is open.
  useEffect(() => {
    return () => rightSidebar.clearRight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedRows = useMemo(() => {
    if (!displayResult || !sortColumn) return displayResult?.rows || [];
    return [...displayResult.rows].sort((a, b) => {
      const aVal = a[sortColumn]; const bVal = b[sortColumn];
      if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [displayResult, sortColumn, sortDirection]);

  const insertRows = useMemo(
    () => pendingChanges
      .filter(c => c.op === 'insert')
      .map(c => ({ id: c.id, values: { ...(c.newValue as Record<string, unknown>), __stagedInsert: true } as Record<string, unknown> })),
    [pendingChanges]
  );

  const pendingDeleteKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const c of pendingChanges) {
      if (c.op !== 'delete') continue;
      keys.add(JSON.stringify(c.pkValues));
    }
    return keys;
  }, [pendingChanges]);

  const getPkValues = useCallback((row: Record<string, unknown>) => {
    const pks: Record<string, unknown> = {};
    for (const pk of pkColumns || []) if (pk in row) pks[pk] = row[pk];
    return pks;
  }, [pkColumns]);

  const isPendingDelete = useCallback((row: Record<string, unknown>) => {
    return pendingDeleteKeys.has(JSON.stringify(getPkValues(row)));
  }, [pendingDeleteKeys, getPkValues]);

  const getChangeForCell = useCallback((row: Record<string, unknown>, colName: string): PendingChange | undefined => {
    return pendingChanges.find(c =>
      c.columnName === colName &&
      Object.entries(c.pkValues).every(([k, v]) => row[k] === v)
    );
  }, [pendingChanges]);

  const handleSort = (column: string) => {
    if (sortColumn === column) setSortDirection(d => d === "asc" ? "desc" : "asc");
    else { setSortColumn(column); setSortDirection("asc"); }
  };

  const handleRowClick = (row: Record<string, unknown>) => {
    if (!canEdit) return;
    setEditor({ mode: 'edit', row });
  };

  /** Stage a delete for the row shown in the sidebar editor, then close it. */
  const handleDeleteRowFromEditor = (row: Record<string, unknown>) => {
    if (!canEdit || !schema || !table) return;
    const pkEntries = Object.entries(getPkValues(row));
    if (pkEntries.length === 0) { toast.error("Cannot delete: no primary key"); return; }
    const whereClause = pkEntries.map(([k], i) => `"${k}" = $${i + 1}`).join(' AND ');
    const change: PendingChange = {
      id: `delete-${schema}.${table}-${Date.now()}`,
      schema, table, op: 'delete',
      columnName: '', dataType: '',
      pkValues: getPkValues(row), originalValue: null, newValue: null,
      statement: {
        query: `DELETE FROM "${schema}"."${table}" WHERE ${whereClause}`,
        params: pkEntries.map(([, v]) => v),
      },
    };
    setPendingChanges(prev => [...prev, change]);
    toast.info("Delete staged — review & apply to commit");
    rightSidebar.closeRight();
    setEditor(null);
  };

  const handleCellDoubleClick = (rowIdxInSorted: number, col: string, dataType: string, value: unknown) => {
    if (!canEdit) return;
    const inputType = getInputType(dataType);
    if (inputType === 'maybe-enum' && enumCache[dataType] === undefined && !enumLoading[dataType]) {
      setEnumLoading(prev => ({ ...prev, [dataType]: true }));
      setEditingCell({ rowIdx: rowIdxInSorted, col });
      setEditValue(formatValueForInput(value, 'text'));
      invoke<string[]>("get_enum_values", { connectionId, typeName: dataType })
        .then(vals => { setEnumCache(prev => ({ ...prev, [dataType]: vals || [] })); setEnumLoading(prev => ({ ...prev, [dataType]: false })); })
        .catch(() => { setEnumCache(prev => ({ ...prev, [dataType]: [] })); setEnumLoading(prev => ({ ...prev, [dataType]: false })); });
      return;
    }
    setEditingCell({ rowIdx: rowIdxInSorted, col });
    setEditValue(formatValueForInput(value, inputType));
  };

  const handleSaveEdit = (row: Record<string, unknown>, overrideValue?: string) => {
    if (!editingCell || !canEdit || !schema || !table) return;
    const colMeta = displayResult?.columns?.find(c => c.name === editingCell.col);
    const inputType = getInputType(colMeta?.dataType || '');
    const newVal = overrideValue !== undefined ? overrideValue : editValue;
    if (newVal === formatValueForInput(row[editingCell.col], inputType)) { setEditingCell(null); return; }
    const change: PendingChange = {
      id: `${schema}.${table}.${editingCell.col}-${Date.now()}`,
      schema, table,
      columnName: editingCell.col,
      dataType: colMeta?.dataType || '',
      pkValues: getPkValues(row),
      originalValue: row[editingCell.col],
      newValue: newVal,
    };
    setPendingChanges(prev => [...prev, change]);
    setEditingCell(null);
  };

  const handleCancelEdit = () => setEditingCell(null);

  const handleOpenInsert = () => {
    setEditor({ mode: 'insert', row: null });
    rightSidebar.setOpen(true);
  };
  const handleStageRowEdits = (changes: PendingChange[]) => {
    setPendingChanges(prev => [...prev, ...changes]);
    toast.info(`${changes.length} change${changes.length !== 1 ? 's' : ''} staged — review & apply to commit`);
  };

  const handleUnstage = (id: string) => setPendingChanges(prev => prev.filter(c => c.id !== id));

  const handleInsertSubmit = (statement: RowMutationStatement, values: Record<string, unknown>) => {
    if (!schema || !table) return;
    const change: PendingChange = {
      id: `insert-${schema}.${table}-${Date.now()}`,
      schema, table, op: 'insert',
      columnName: '', dataType: '',
      pkValues: {}, originalValue: null, newValue: values,
      statement,
    };
    setPendingChanges(prev => [...prev, change]);
    toast.info("Insert staged — review & apply to commit");
  };

  const handleDeleteSelected = () => {
    if (!canEdit || !schema || !table) return;
    const rows = Array.from(selectedRows).map(i => sortedRows[i]).filter((r): r is Record<string, unknown> => !!r);
    const changes: PendingChange[] = rows.map((row, idx) => {
      const pkEntries = Object.entries(getPkValues(row));
      const whereClause = pkEntries.map(([k], i) => `"${k}" = $${i + 1}`).join(' AND ');
      return {
        id: `delete-${schema}.${table}-${Date.now()}-${idx}`,
        schema, table, op: 'delete',
        columnName: '', dataType: '',
        pkValues: getPkValues(row), originalValue: null, newValue: null,
        statement: {
          query: `DELETE FROM "${schema}"."${table}" WHERE ${whereClause}`,
          params: pkEntries.map(([, v]) => v),
        },
      };
    });
    setPendingChanges(prev => [...prev, ...changes]);
    setSelectedRows(new Set());
    setDeleteDialogOpen(false);
    toast.info(`Staged ${changes.length} delete${changes.length !== 1 ? 's' : ''} — review & apply to commit`);
  };

  const handleApplyAll = async () => {
    if (!connectionId) return;
    setApplying(true);
    try {
      const statements: RowMutationStatement[] = [];
      for (const change of pendingChanges) {
        if (change.op === 'insert') {
          if (change.statement) statements.push(change.statement);
        } else if (change.op === 'delete') {
          if (change.statement) statements.push(change.statement);
        } else {
          const pkEntries = Object.entries(change.pkValues);
          const whereClause = pkEntries.map(([k], i) => `"${k}" = $${i + 2}`).join(' AND ');
          statements.push({
            query: `UPDATE "${change.schema}"."${change.table}" SET "${change.columnName}" = $1 WHERE ${whereClause}`,
            params: [toSqlParamValue(String(change.newValue), change.dataType), ...pkEntries.map(([, v]) => v)],
          });
        }
      }
      if (statements.length === 0) { setApplying(false); return; }
      await API.mutateRows(connectionId, statements);
      if (displayResult) {
        const newRows = displayResult.rows.map(row => {
          const rowChanges = pendingChanges.filter(c =>
            c.op !== 'delete' && c.op !== 'insert' &&
            Object.entries(c.pkValues).every(([k, v]) => row[k] === v)
          );
          if (rowChanges.length === 0) return row;
          const newRow = { ...row };
          for (const ch of rowChanges) {
            if (ch.dataType === 'boolean' || ch.dataType === 'bool') {
              newRow[ch.columnName] = ch.newValue === '' ? null : ch.newValue === 'true';
            } else if (/^int|float|numeric|decimal|serial|real|double/.test(ch.dataType.toLowerCase())) {
              newRow[ch.columnName] = ch.newValue === '' ? null : Number(ch.newValue);
            } else {
              newRow[ch.columnName] = ch.newValue === '' ? null : ch.newValue;
            }
          }
          return newRow;
        });
        setLocalRows(newRows);
      }
      toast.success(`Applied ${statements.length} change${statements.length !== 1 ? 's' : ''}`);
      setPendingChanges([]);
      setSelectedRows(new Set());
      setShowReviewSheet(false);
      if (onRefresh) onRefresh();
    } catch (e: any) {
      toast.error("Apply failed", { description: String(e) });
    }
    setApplying(false);
  };

  const handleCopyJson = async () => {
    if (!exportResult) return;
    try {
      await navigator.clipboard.writeText(toJson(exportResult));
      toast.success("Copied as JSON");
    } catch (e: any) {
      toast.error("Copy failed", { description: String(e) });
    }
  };

  const exportBaseName = schema && table ? `${schema}.${table}` : 'query-result';

  const handleExportCsv = () => {
    if (exportResult) downloadText(`${exportBaseName}.csv`, toCsv(exportResult), 'text/csv');
  };

  const handleExportJson = () => {
    if (exportResult) downloadText(`${exportBaseName}.json`, toJson(exportResult), 'application/json');
  };

  if (loading) return <ResultsLoadingSkeleton />;
  if (error) return <div className="p-4 text-sm text-destructive bg-destructive/10 rounded-md"><div className="font-medium mb-1">Error</div><div className="font-mono text-xs">{error}</div></div>;
  if (!displayResult) return (
    <div className="w-full border border-yellow-500/50 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-md p-4">
      <div className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 shrink-0" />
        <span>No results to display</span>
      </div>
    </div>
  );

  const paginatedRows = sortedRows;
  const hasRows = paginatedRows.length > 0 || insertRows.length > 0;

  const toggleAllSelect = (checked: boolean) => {
    if (checked) setSelectedRows(new Set(paginatedRows.map((_, i) => i)));
    else setSelectedRows(new Set());
  };
  const toggleRowSelect = (index: number) => {
    setSelectedRows(prev => { const n = new Set(prev); n.has(index) ? n.delete(index) : n.add(index); return n; });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border bg-card/80 backdrop-blur-sm px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5"><Download className="h-3.5 w-3.5" />Export</Button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-1" align="start">
              <div className="flex flex-col">
                <button onClick={handleExportCsv} className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground">
                  <FileDown className="h-3.5 w-3.5" />Export CSV
                </button>
                <button onClick={handleExportJson} className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground">
                  <Download className="h-3.5 w-3.5" />Export JSON
                </button>
                <button onClick={handleCopyJson} className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground">
                  <Copy className="h-3.5 w-3.5" />Copy as JSON
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {canEdit && (() => {
        const slot = typeof document !== 'undefined' ? document.getElementById('table-actions-slot') : null;
        if (!slot) return null;
        return createPortal(
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleOpenInsert}><Plus className="h-3.5 w-3.5" />Insert Row</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10" disabled={selectedRows.size === 0} onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />Delete Selected ({selectedRows.size})
            </Button>
          </div>, slot);
      })()}
      {hasRows ? (
        <>
          <div className="flex-1 overflow-auto">
            <Table className="min-w-max">
                <TableHeader className="sticky top-0 bg-table-header z-50 shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow className="hover:bg-muted/50">
                  <TableHead className="sticky left-0 z-30 bg-table-header pl-8 pr-8 shadow-[inset_-1px_0_0_hsl(var(--border))]" style={{ width: 'var(--checkbox-w)' }}><Checkbox checked={selectedRows.size === paginatedRows.length && paginatedRows.length > 0} onCheckedChange={toggleAllSelect} /></TableHead>
                  {(displayResult.columns || []).map((field, colIdx) => (
                    <TableHead key={field.name} className={cn("group select-none min-w-[140px] shadow-[inset_-1px_0_0_hsl(var(--border))] last:shadow-none", field.name === 'id' && "sticky z-30 bg-table-header")} style={field.name === 'id' ? { left: 'var(--checkbox-w)' } : undefined}>
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <div className="flex items-center justify-between w-full cursor-pointer" onClick={() => handleSort(field.name)}>
                            <span className="text-xs font-medium">{field.name}</span>
                            <div className="flex items-center gap-0.5">
                              {sortColumn === field.name && <span className="text-xs font-medium tabular-nums">{sortDirection === "asc" ? "↑" : "↓"}</span>}
                              <Popover open={sortDropdownCol === field.name} onOpenChange={(open) => setSortDropdownCol(open ? field.name : null)}>
                                <PopoverTrigger asChild>
                                  <button onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 h-4 w-4 flex items-center justify-center rounded hover:bg-foreground/10 transition-opacity">
                                    <ChevronDown className="h-3 w-3" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-40 p-1" align="start" side="bottom">
                                  <div className="flex flex-col gap-0.5">
                                    {getSortOptions(field.dataType).map(opt => (
                                      <button key={opt.direction} onClick={() => { setSortColumn(field.name); setSortDirection(opt.direction); setSortDropdownCol(null); }}
                                        className={cn("flex items-center px-2 py-1.5 text-xs rounded hover:bg-accent hover:text-accent-foreground text-left transition-colors cursor-pointer", sortColumn === field.name && sortDirection === opt.direction && "bg-accent font-medium")}>
                                        {opt.label}
                                      </button>
                                    ))}
                                    {sortColumn === field.name && <><div className="border-t border-border my-0.5" /><button onClick={() => { setSortColumn(null); setSortDropdownCol(null); }} className="flex items-center px-2 py-1.5 text-xs rounded hover:bg-accent hover:text-accent-foreground text-left transition-colors text-muted-foreground cursor-pointer">Clear sort</button></>}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </div>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-40">
                          {getSortOptions(field.dataType).map(opt => (
                            <ContextMenuItem key={opt.direction} onSelect={() => { setSortColumn(field.name); setSortDirection(opt.direction); }}>
                              <span className="flex-1">{opt.label}</span>
                              {sortColumn === field.name && sortDirection === opt.direction && <Check className="h-3 w-3 ml-2 shrink-0" />}
                            </ContextMenuItem>
                          ))}
                          {sortColumn === field.name && <><div className="border-t border-border mx-1 my-0.5" /><ContextMenuItem onSelect={() => setSortColumn(null)}><X className="h-3 w-3 mr-2" />Clear sort</ContextMenuItem></>}
                        </ContextMenuContent>
                      </ContextMenu>
                    </TableHead>
                  ))}
                  {canEdit && onAddColumn && (
                    <TableHead className="min-w-[140px] text-left shadow-[inset_-1px_0_0_hsl(var(--border))] last:shadow-none">
                      <button onClick={onAddColumn} title="Add new column (open editor)" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                        <Plus className="h-3.5 w-3.5" />
                        <span className="text-xs">New Column</span>
                      </button>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRows.map((row, rowIndex) => {
                  const actualIndex = rowIndex;
                  const isSelected = selectedRows.has(actualIndex);
                  const pendingDelete = isPendingDelete(row);
                  return (
                    <TableRow key={`row-${actualIndex}`} className={cn("hover:bg-transparent", pendingDelete && "opacity-40", canEdit && "cursor-pointer")} data-state={isSelected ? "selected" : undefined} onClick={() => handleRowClick(row)}>
                      <TableCell onClick={(e) => e.stopPropagation()} className="sticky left-0 z-20 bg-background pl-8 pr-8 border-r border-border" style={{ width: 'var(--checkbox-w)' }}><Checkbox checked={isSelected} onCheckedChange={() => toggleRowSelect(actualIndex)} /></TableCell>
                      {(displayResult.columns || []).map((field, colIdx) => {
                        const value = row[field.name]; const isNull = value === null;
                        const change = getChangeForCell(row, field.name);
                        const displayValue = change ? change.newValue : value;
                        const showNull = displayValue === null;
                        const isEditing = editingCell?.rowIdx === actualIndex && editingCell?.col === field.name;
                        const isSelectedCell = selectedCell?.rowIdx === actualIndex && selectedCell?.col === field.name;
                        const inputType = getInputType(field.dataType);
                        const enumVals = inputType === 'maybe-enum' ? enumCache[field.dataType] : null;
                        return (<TableCell key={field.name}
                          className={cn("min-w-[140px] max-w-[300px] truncate cursor-pointer relative border-r border-border last:border-r-0 hover:bg-muted/50", field.name === 'id' && "sticky z-20 bg-background", showNull && "text-muted-foreground italic", change && "bg-amber-500/15 ring-1 ring-amber-500", isEditing && "bg-blue-500/10 ring-1 ring-blue-500", isSelectedCell && !isEditing && !change && "bg-blue-500/10 ring-1 ring-blue-500", pendingDelete && "line-through")}
                          style={field.name === 'id' ? { left: 'var(--checkbox-w)' } : undefined}
                          onDoubleClick={(e) => { e.stopPropagation(); if (!pendingDelete) handleCellDoubleClick(actualIndex, field.name, field.dataType, value); }}
                          onClick={(e) => { e.stopPropagation(); setSelectedCell({ rowIdx: actualIndex, col: field.name }); if (!pendingDelete) handleRowClick(row); }} title={showNull ? "NULL" : displayValueToString(displayValue)}>
                          {isEditing ? (inputType === 'select-boolean' ? (
                            <InlineSelect
                              value={editValue} options={['true', 'false', '']} labels={['true', 'false', 'NULL']}
                              onChange={setEditValue} onSave={(v) => handleSaveEdit(row, v)} onCancel={handleCancelEdit}
                            />
                          ) : enumVals && enumVals.length > 0 ? (
                            <InlineSelect
                              value={editValue} options={[...enumVals, '']}
                              onChange={setEditValue} onSave={(v) => handleSaveEdit(row, v)} onCancel={handleCancelEdit}
                            />
                          ) : inputType === 'maybe-enum' && enumLoading[field.dataType] ? (
                            <span className="text-muted-foreground italic">Loading...</span>
                          ) : (
                            <input
                              type={inputType === 'maybe-enum' ? 'text' : inputType}
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => handleSaveEdit(row)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(row); if (e.key === 'Escape') handleCancelEdit(); }}
                              autoFocus
                              className="w-full bg-transparent border-0 outline-none focus:outline-none focus:ring-0 p-0 m-0 text-foreground text-xs"
                            />
                          )) : (
                            <span>{showNull ? "NULL" : displayValueToString(displayValue)}</span>
                          )}
                        </TableCell>);
                      })}
                      {canEdit && onAddColumn && <TableCell className="p-0" />}
                    </TableRow>
                  );
                })}
                {canEdit && insertRows.map(({ id, values }) => (
                  <TableRow key={`ins-${id}`} className="bg-emerald-500/5 hover:bg-transparent">
                    <TableCell className="sticky left-0 z-20 bg-background pl-8 pr-8 border-r border-border" style={{ width: 'var(--checkbox-w)' }}>
                      <span className="inline-block h-4 w-4 rounded-sm border border-dashed border-emerald-500/50" aria-hidden />
                    </TableCell>
                    {(displayResult.columns || []).map(field => {
                      const value = values[field.name];
                      const showNull = value === null || value === undefined;
                      return (
                        <TableCell key={field.name}
                          className={cn("min-w-[140px] max-w-[300px] truncate relative border-r border-border last:border-r-0", field.name === 'id' && "sticky z-20 bg-background", showNull && "text-muted-foreground italic")}
                          style={field.name === 'id' ? { left: 'var(--checkbox-w)' } : undefined}
                          title={showNull ? "NULL" : displayValueToString(value)}>
                          <span className="text-emerald-600/80">{showNull ? "NULL" : displayValueToString(value)}</span>
                        </TableCell>
                      );
                    })}
                    {canEdit && onAddColumn && <TableCell className="p-0" />}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <div className="w-full border border-yellow-500/50 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-md p-4">
          <div className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{schema && table ? "This table contains no rows" : "Query returned no rows"}</span>
          </div>
        </div>
      )}
      {canEdit && pendingChanges.length > 0 && (() => {
        const slot = typeof document !== 'undefined' ? document.getElementById('review-changes-slot') : null;
        if (!slot) return null;
        return createPortal(
          <Button variant="outline" size="sm" onClick={() => setShowReviewSheet(true)}
            className="text-amber-600 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/10">
            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
            Review ({pendingChanges.length}) change{pendingChanges.length !== 1 ? 's' : ''}
          </Button>, slot);
      })()}
      {canEdit && (
        <ReviewChangesSheet open={showReviewSheet} onOpenChange={setShowReviewSheet}
          changes={pendingChanges} onUnstage={handleUnstage} onApplyAll={handleApplyAll} applying={applying} />
      )}
      {canEdit && (
        <ConfirmDialog
          open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}
          title={`Delete ${selectedRows.size} Row${selectedRows.size !== 1 ? 's' : ''}`}
          description={`This will DELETE ${selectedRows.size} row${selectedRows.size !== 1 ? 's' : ''} from ${schema}.${table}. Deletion is staged with your other changes and committed atomically via Apply.`}
          confirmLabel="Stage Delete"
          destructive
          onConfirm={handleDeleteSelected}
        />
      )}
    </div>
  );
}
