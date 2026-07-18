"use client";
import { Table as TableIcon, Loader2, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Table } from "./types";

interface TableListProps {
  tables: Table[];
  isLoading?: boolean;
  tableSearchTerm?: string;
  isMongoDB?: boolean;
  onRefresh?: () => void;
  onTableSelect: (schema: string, table: string) => void;
  onOpenNewTableTab?: (schema: string) => void;
  selectedSchema?: string;
}

export function TableList({ tables, isLoading, tableSearchTerm, isMongoDB, onRefresh, onTableSelect, onOpenNewTableTab, selectedSchema }: TableListProps) {
  const filteredTables = tableSearchTerm?.trim()
    ? tables.filter(t => t.name.toLowerCase().includes(tableSearchTerm.toLowerCase()))
    : tables;

  return (
    <div className="space-y-1">
      {selectedSchema && !isMongoDB && (
        <div className="flex items-center justify-between px-2 py-2 mb-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tables</div>
          <div className="flex items-center gap-1">
            {onRefresh && (
              <TooltipProvider><Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className={cn("h-6 w-6", isLoading && "text-muted-foreground opacity-50")} disabled={isLoading} onClick={onRefresh}>
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Refresh tables</p></TooltipContent>
              </Tooltip></TooltipProvider>
            )}
            {onOpenNewTableTab && (
              <TooltipProvider><Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onOpenNewTableTab(selectedSchema || "public")}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Create new table</p></TooltipContent>
              </Tooltip></TooltipProvider>
            )}
          </div>
        </div>
      )}
      {filteredTables.length === 0 ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">
          {tableSearchTerm ? "No tables found" : isMongoDB ? "No collections" : "No tables"}
        </div>
      ) : (
        <div className="space-y-0.5">
          {filteredTables.map((table) => (
            <button key={`${table.schema}.${table.name}`} onClick={() => onTableSelect(table.schema, table.name)}
              className="group flex items-center gap-1 w-full">
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground text-left">
                <TableIcon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{table.name}</span>
                {table.rowCount !== undefined && <span className="text-xs text-muted-foreground">{table.rowCount.toLocaleString()}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
