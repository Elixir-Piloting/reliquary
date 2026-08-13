"use client";
import { Table2, Eye, Layers, Loader2, Plus, RefreshCw, ShieldAlert, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
} from "@/components/ui/context-menu";
import type { Table } from "./types";

interface TableListProps {
  tables: Table[];
  isLoading?: boolean;
  tableSearchTerm?: string;
  onRefresh?: () => void;
  onTableSelect: (schema: string, table: string) => void;
  onOpenNewTableTab?: (schema: string) => void;
  onOpenTableDetails?: (schema: string, table: string) => void;
  selectedSchema?: string;
}

function tableKind(table: Table): { icon: typeof Table2; label: string } {
  const type = (table.tableType || "TABLE").toUpperCase();
  if (type.includes("MATERIALIZED")) return { icon: Layers, label: "Materialized view" };
  if (type.includes("VIEW")) return { icon: Eye, label: "View" };
  if (type.includes("PARTITIONED")) return { icon: Table2, label: "Partitioned table" };
  return { icon: Table2, label: "Table" };
}

export function TableList({ tables, isLoading, tableSearchTerm, onRefresh, onTableSelect, onOpenNewTableTab, onOpenTableDetails, selectedSchema }: TableListProps) {
  const filteredTables = tableSearchTerm?.trim()
    ? tables.filter(t => t.name.toLowerCase().includes(tableSearchTerm.toLowerCase()))
    : tables;

  return (
    <div className="space-y-1">
      {selectedSchema && (
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
          {tableSearchTerm ? "No tables found" : "No tables"}
        </div>
      ) : (
        <div className="space-y-0.5">
          {filteredTables.map((table) => {
            const { icon: KindIcon, label: kindLabel } = tableKind(table);
            return (
              <ContextMenu key={`${table.schema}.${table.name}`}>
                <ContextMenuTrigger asChild>
                  <div className="group relative flex items-center w-full">
                    <button onClick={() => onTableSelect(table.schema, table.name)}
                      className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground text-left min-w-0">
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
                      <span className="flex-1 text-left truncate">{table.name}</span>
                      {table.rowCount !== undefined && (
                        <TooltipProvider delayDuration={600}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs text-muted-foreground shrink-0 tabular-nums">~{table.rowCount.toLocaleString()}</span>
                            </TooltipTrigger>
                            <TooltipContent side="right"><p>Estimated row count</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
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
                    {onOpenTableDetails && (
                      <button onClick={() => onOpenTableDetails(table.schema, table.name)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0 mr-1"
                        aria-label={`Details for ${table.name}`}>
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => onOpenTableDetails?.(table.schema, table.name)}>
                    <Info className="h-4 w-4 mr-2" />
                    Details
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      )}
    </div>
  );
}
