"use client";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Check, Copy, X, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import type { QueryResult, ResultsViewerProps, PendingChange } from "./types";
import { PAGE_SIZE_OPTIONS } from "./types";
import { ReviewChangesSheet } from "./review-changes-sheet";

function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  const str = String(value);
  if (/^-?\d+(\.\d+)?$/.test(str)) return str;
  return `'${str.replace(/'/g, "''")}'`;
}

function formatValueForInput(value: unknown, inputType: string): string {
  if (value === null) return '';
  const str = String(value);
  if (inputType === 'date') {
    const m = str.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : str;
  }
  if (inputType === 'datetime-local') {
    const cleaned = str.replace(' ', 'T');
    return cleaned.length > 16 ? cleaned.substring(0, 16) : cleaned;
  }
  return str;
}

const BUILTIN_TYPES = new Set([
  'int2','int4','int8','int','integer','smallint','bigint','serial','smallserial','bigserial',
  'float4','float8','real','float','double precision','numeric','decimal','money',
  'bool','boolean',
  'text','varchar','char','character varying','character','bpchar','name',
  'bytea',
  'date','time','timetz','timestamp','timestamptz','interval',
  'uuid','json','jsonb',
  'inet','cidr','macaddr',
  'xml','oid',
  'point','line','lseg','box','path','polygon','circle',
  'tsvector','tsquery',
]);

function isPotentialEnum(dataType: string): boolean {
  const dt = dataType.toLowerCase();
  if (dt === 'boolean' || dt === 'bool') return false;
  if (dt.includes('date') || dt.includes('timestamp') || dt.includes('time')) return false;
  return !BUILTIN_TYPES.has(dt);
}

function getInputType(dataType: string): string {
  const dt = dataType.toLowerCase();
  if (dt === 'boolean' || dt === 'bool') return 'select-boolean';
  if (dt.includes('date')) return 'date';
  if (dt.includes('timestamp') || dt.includes('time')) return 'datetime-local';
  if (isPotentialEnum(dt)) return 'maybe-enum';
  return 'text';
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
  result, error, loading, schema, table, onRefresh, enableCRUD, provider, connectionId, pkColumns, onAddColumn
}: ResultsViewerProps) {
  const [internalPage, setInternalPage] = useState(1);
  const [internalPageSize, setInternalPageSize] = useState(100);
  const page = internalPage; const setPage = setInternalPage;
  const pageSize = internalPageSize; const setPageSize = setInternalPageSize;
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [pageSizePopoverOpen, setPageSizePopoverOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const [enumCache, setEnumCache] = useState<Record<string, string[] | null>>({});
  const [enumLoading, setEnumLoading] = useState<Record<string, boolean>>({});
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [showReviewSheet, setShowReviewSheet] = useState(false);
  const [applying, setApplying] = useState(false);
  const [localRows, setLocalRows] = useState<Record<string, unknown>[] | null>(null);
  const canEdit = enableCRUD && schema && table && pkColumns && pkColumns.length > 0 && connectionId;
  const displayResult = localRows ? { ...result, rows: localRows } : result;

  useEffect(() => { setLocalRows(null); }, [result]);

  useEffect(() => {
    if (!editingCell) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const td = (t as HTMLElement)?.closest('td');
      if (td && td.querySelector('input, button')) return;
      (document.activeElement as HTMLElement)?.blur();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [editingCell]);

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

  const getPkValues = useCallback((row: Record<string, unknown>) => {
    const pks: Record<string, unknown> = {};
    for (const pk of pkColumns || []) if (pk in row) pks[pk] = row[pk];
    return pks;
  }, [pkColumns]);

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

  const copyCell = (value: any) => { navigator.clipboard.writeText(value === null ? "NULL" : String(value)); };

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

  const handleUnstage = (id: string) => setPendingChanges(prev => prev.filter(c => c.id !== id));

  const handleApplyAll = async () => {
    if (!connectionId) return;
    setApplying(true);
    for (const change of pendingChanges) {
      try {
        const whereClause = Object.entries(change.pkValues)
          .map(([k, v]) => `"${k}" = ${escapeSqlValue(v)}`)
          .join(" AND ");
        const query = `UPDATE "${change.schema}"."${change.table}" SET "${change.columnName}" = ${escapeSqlValue(change.newValue)} WHERE ${whereClause}`;
        await invoke("execute_query", { connectionId, query });
      } catch (e) { console.error("Apply failed:", e); }
    }
    setApplying(false);
    if (displayResult) {
      const newRows = displayResult.rows.map(row => {
        const rowChanges = pendingChanges.filter(c =>
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
    setPendingChanges([]);
    setShowReviewSheet(false);
  };

  if (loading) return <ResultsLoadingSkeleton />;
  if (error) return <div className="p-4 text-sm text-destructive bg-destructive/10 rounded-md"><div className="font-medium mb-1">Error</div><div className="font-mono text-xs">{error}</div></div>;
  if (!displayResult || displayResult.rows.length === 0) return (
    <div className="w-full border border-yellow-500/50 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-md p-4">
      <div className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{displayResult?.rowCount === 0 ? "This table contains no rows" : "No results to display"}</span>
      </div>
    </div>
  );

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const paginatedRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);
  const startRow = (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, sortedRows.length);

  const toggleAllSelect = (checked: boolean) => {
    if (checked) setSelectedRows(new Set(paginatedRows.map((_, i) => (page - 1) * pageSize + i)));
    else setSelectedRows(new Set());
  };
  const toggleRowSelect = (index: number) => {
    setSelectedRows(prev => { const n = new Set(prev); n.has(index) ? n.delete(index) : n.add(index); return n; });
  };

  const handlePageSizeChange = (newSize: number) => { setPageSize(newSize); setPage(1); setPageSizePopoverOpen(false); };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto px-4 py-2 pb-32">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-50 shadow-[0_1px_0_0_hsl(var(--border))]">
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={selectedRows.size === paginatedRows.length && paginatedRows.length > 0} onCheckedChange={toggleAllSelect} /></TableHead>
              {(displayResult.columns || []).map(field => (
                <TableHead key={field.name} className="cursor-pointer select-none min-w-[140px] border-r border-border last:border-r-0" onClick={() => handleSort(field.name)}>
                  <div className="flex items-center gap-1"><span>{field.name}</span>{sortColumn === field.name && <span className="text-xs">{sortDirection === "asc" ? "↑" : "↓"}</span>}</div>
                </TableHead>
              ))}
              {canEdit && onAddColumn && (
                <TableHead className="min-w-[140px] text-left border-r border-border last:border-r-0">
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
              const actualIndex = (page - 1) * pageSize + rowIndex;
              const isSelected = selectedRows.has(actualIndex);
              return (
                <TableRow key={actualIndex} data-state={isSelected ? "selected" : undefined}>
                  <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleRowSelect(actualIndex)} /></TableCell>
                  {(displayResult.columns || []).map(field => {
                    const value = row[field.name]; const isNull = value === null;
                    const isEditing = editingCell?.rowIdx === actualIndex && editingCell?.col === field.name;
                    const change = getChangeForCell(row, field.name);
                    const displayValue = change ? change.newValue : value;
                    const showNull = displayValue === null;
                    const inputType = getInputType(field.dataType);
                    const enumVals = inputType === 'maybe-enum' ? enumCache[field.dataType] : null;
                    return (<TableCell key={field.name}
                      className={cn("min-w-[140px] max-w-[300px] truncate cursor-pointer relative border-r border-border last:border-r-0", showNull && "text-muted-foreground italic", change && "bg-amber-500/15 ring-1 ring-amber-500", isEditing && "bg-blue-500/10 ring-1 ring-blue-500")}
                      onDoubleClick={(e) => { e.stopPropagation(); handleCellDoubleClick(actualIndex, field.name, field.dataType, value); }}
                      onClick={() => copyCell(value)} title={showNull ? "NULL" : String(displayValue)}>
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
                        <span>{showNull ? "NULL" : String(displayValue)}</span>
                      )}
                    </TableCell>);
                  })}
                  {canEdit && onAddColumn && <TableCell className="p-0" />}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="shrink-0 border-t border-border bg-card/80 backdrop-blur-sm px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{sortedRows.length.toLocaleString()} rows</span>
            <span className="text-border">·</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs">Rows per page</span>
              <Popover open={pageSizePopoverOpen} onOpenChange={setPageSizePopoverOpen}>
                <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-7 px-2 text-xs font-medium min-w-[3.5rem]">{pageSize}</Button></PopoverTrigger>
                <PopoverContent className="w-28 p-1" align="start">
                  <div className="flex flex-col">{PAGE_SIZE_OPTIONS.map(size => (
                    <button key={size} onClick={() => handlePageSizeChange(size)}
                      className={cn("flex items-center justify-between rounded-sm px-2 py-1.5 text-sm cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground", pageSize === size && "bg-accent text-accent-foreground font-medium")}>
                      <span>{size}</span>{pageSize === size && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}</div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground tabular-nums">{startRow}–{endRow} of {sortedRows.length.toLocaleString()}</span>
            <span className="text-sm text-muted-foreground">({page}/{totalPages})</span>
            <div className="flex items-center gap-0.5 ml-1">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(1)} disabled={page <= 1}><ChevronsLeft className="h-3.5 w-3.5" /></Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft className="h-3.5 w-3.5" /></Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}><ChevronRight className="h-3.5 w-3.5" /></Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(totalPages)} disabled={page >= totalPages}><ChevronsRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>
      </div>
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
    </div>
  );
}
