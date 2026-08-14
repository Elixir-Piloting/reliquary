"use client";
import { Columns3 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ColumnMeta } from "@/lib/db/types";
import { cn } from "@/lib/utils";

interface ColumnsPopoverProps {
  columns: ColumnMeta[];
  hidden: Set<string>;
  onToggle: (column: string) => void;
  onSetHidden: (hidden: Set<string>) => void;
}

export function ColumnsPopover({ columns, hidden, onToggle, onSetHidden }: ColumnsPopoverProps) {
  const allHidden = columns.length > 0 && columns.every(c => hidden.has(c.name));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 px-1.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground transition-colors" title="Toggle columns">
          <Columns3 className="h-3.5 w-3.5" />
          <span>Columns</span>
          {hidden.size > 0 && <span className="text-[10px]">{hidden.size} hidden</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-xs font-medium text-muted-foreground">Visible columns</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onSetHidden(new Set())}>Show all</Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onSetHidden(new Set(columns.map(c => c.name)))}>Hide all</Button>
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto space-y-0.5">
          {columns.map(col => {
            const isHidden = hidden.has(col.name);
            return (
              <label key={col.name} className={cn("flex items-center gap-2 px-1 py-1 rounded cursor-pointer hover:bg-accent transition-colors", isHidden && "opacity-60")}>
                <Checkbox checked={!isHidden} onCheckedChange={() => onToggle(col.name)} />
                <span className="text-xs truncate font-mono">{col.name}</span>
                <span className="text-[10px] text-muted-foreground truncate ml-auto">{col.dataType}</span>
              </label>
            );
          })}
        </div>
        {allHidden && columns.length > 0 && (
          <p className="px-1 pt-2 text-[10px] text-muted-foreground">All columns hidden — rows are still visible.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
