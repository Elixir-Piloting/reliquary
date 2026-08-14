"use client";
import { useState, useEffect } from "react";
import { Filter, Plus, X, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { TableFilter, TableFilterOperator, ColumnMeta } from "@/lib/db/types";
import { cn } from "@/lib/utils";

interface FilterRow {
  id: string;
  column: string;
  operator: TableFilterOperator;
  value: string;
  active: boolean;
}

const OPERATORS: { value: TableFilterOperator; label: string }[] = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "like", label: "like" },
  { value: "not_like", label: "not like" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "is_null", label: "is null" },
  { value: "is_not_null", label: "is not null" },
];

const NO_VALUE_OPS: TableFilterOperator[] = ["is_null", "is_not_null"];

interface FilterPopoverProps {
  columns: ColumnMeta[];
  filters: TableFilter[];
  onApply: (filters: TableFilter[]) => void;
}

function toRow(f: TableFilter): FilterRow {
  return { id: `${f.column}-${f.operator}-${f.value ?? ''}-${Math.random().toString(36).slice(2, 7)}`, column: f.column, operator: f.operator, value: f.value ?? "", active: true };
}

export function FilterPopover({ columns, filters, onApply }: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FilterRow[]>([]);

  useEffect(() => {
    if (open) {
      setRows(filters.length > 0 ? filters.map(toRow) : [{ id: crypto.randomUUID(), column: columns[0]?.name ?? "", operator: "eq", value: "", active: true }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateRow = (id: string, patch: Partial<FilterRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const addRow = () => {
    setRows(prev => [...prev, { id: crypto.randomUUID(), column: columns[0]?.name ?? "", operator: "eq", value: "", active: true }]);
  };

  const removeRow = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const apply = () => {
    const applied = rows
      .filter(r => r.active)
      .filter(r => r.column && (NO_VALUE_OPS.includes(r.operator) || r.value.trim() !== ""))
      .map(r => ({ column: r.column, operator: r.operator, value: r.operator === "is_null" || r.operator === "is_not_null" ? undefined : r.value.trim() }));
    onApply(applied);
    setOpen(false);
  };

  const hasActive = filters.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn("flex items-center gap-1 px-1.5 py-1 rounded text-xs transition-colors", hasActive ? "text-primary" : "text-muted-foreground hover:text-foreground")} title="Filter">
          <Filter className="h-3.5 w-3.5" />
          <span>Filter</span>
          {hasActive && <span className="text-[10px]">{filters.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[560px] p-3" align="start">
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-xs font-medium text-muted-foreground">Filter rows</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rows.map(row => {
            const noValue = NO_VALUE_OPS.includes(row.operator);
            return (
              <div key={row.id} className="flex items-center gap-2">
                <Checkbox checked={row.active} onCheckedChange={c => updateRow(row.id, { active: !!c })} aria-label="Apply filter" />
                <Select value={row.column} onValueChange={v => updateRow(row.id, { column: v })}>
                  <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="Column" /></SelectTrigger>
                  <SelectContent>
                    {columns.map(c => <SelectItem key={c.name} value={c.name} className="text-xs">{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={row.operator} onValueChange={v => updateRow(row.id, { operator: v as TableFilterOperator })}>
                  <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map(op => <SelectItem key={op.value} value={op.value} className="text-xs">{op.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!noValue && (
                  <Input value={row.value} onChange={e => updateRow(row.id, { value: e.target.value })} placeholder="Value" className="h-7 w-28 text-xs" />
                )}
                <button onClick={() => removeRow(row.id)} className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors" title="Remove filter">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && (
          <p className="px-1 py-3 text-center text-xs text-muted-foreground">No filters</p>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-border mt-2 pt-2">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={addRow}><Plus className="h-3 w-3 mr-1" />Add filter</Button>
          {rows.some(r => r.active) ? (
            <button onClick={() => setRows(prev => prev.map(r => ({ ...r, active: false })))} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Trash2 className="h-3 w-3" />Clear
            </button>
          ) : <span />}
          <Button size="sm" className="h-7 px-3 text-xs" onClick={apply}>
            <Check className="h-3 w-3 mr-1" />Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
