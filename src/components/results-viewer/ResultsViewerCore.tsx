"use client";
import { useState, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QueryResult, ResultsViewerProps } from "./types";
import { PAGE_SIZE_OPTIONS } from "./types";

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
  result, error, loading, schema, table, onRefresh, enableCRUD, provider
}: ResultsViewerProps) {
  const [internalPage, setInternalPage] = useState(1);
  const [internalPageSize, setInternalPageSize] = useState(100);
  const page = internalPage; const setPage = setInternalPage;
  const pageSize = internalPageSize; const setPageSize = setInternalPageSize;
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [pageSizePopoverOpen, setPageSizePopoverOpen] = useState(false);

  const sortedRows = useMemo(() => {
    if (!result || !sortColumn) return result?.rows || [];
    return [...result.rows].sort((a, b) => {
      const aVal = a[sortColumn]; const bVal = b[sortColumn];
      if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [result, sortColumn, sortDirection]);

  if (loading) return <ResultsLoadingSkeleton />;
  if (error) return <div className="p-4 text-sm text-destructive bg-destructive/10 rounded-md"><div className="font-medium mb-1">Error</div><div className="font-mono text-xs">{error}</div></div>;
  if (!result || result.rows.length === 0) return (
    <div className="w-full border border-yellow-500/50 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-md p-4">
      <div className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{result?.rowCount === 0 ? "This table contains no rows" : "No results to display"}</span>
      </div>
    </div>
  );

  const handleSort = (column: string) => {
    if (sortColumn === column) setSortDirection(d => d === "asc" ? "desc" : "asc");
    else { setSortColumn(column); setSortDirection("asc"); }
  };

  const copyCell = (value: any) => { navigator.clipboard.writeText(value === null ? "NULL" : String(value)); };

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
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-50 shadow-[0_1px_0_0_hsl(var(--border))]">
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={selectedRows.size === paginatedRows.length && paginatedRows.length > 0} onCheckedChange={toggleAllSelect} /></TableHead>
              {(result.columns || []).map(field => (
                <TableHead key={field.name} className="cursor-pointer select-none" onClick={() => handleSort(field.name)}>
                  <div className="flex items-center gap-1"><span>{field.name}</span>{sortColumn === field.name && <span className="text-xs">{sortDirection === "asc" ? "↑" : "↓"}</span>}</div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedRows.map((row, rowIndex) => {
              const actualIndex = (page - 1) * pageSize + rowIndex;
              const isSelected = selectedRows.has(actualIndex);
              return (
                <TableRow key={actualIndex} data-state={isSelected ? "selected" : undefined}>
                  <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleRowSelect(actualIndex)} /></TableCell>
                  {(result.columns || []).map(field => {
                    const value = row[field.name]; const isNull = value === null;
                    return (<TableCell key={field.name} className={cn("max-w-[300px] truncate cursor-pointer", isNull && "text-muted-foreground italic")} onClick={() => copyCell(value)} title={isNull ? "NULL" : String(value)}>
                      {isNull ? "NULL" : String(value)}
                    </TableCell>);
                  })}
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
    </div>
  );
}
