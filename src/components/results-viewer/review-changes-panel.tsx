"use client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { X, Check, Loader2, ChevronRight, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PendingChange } from "./types";

interface ReviewChangesPanelProps {
  changes: PendingChange[];
  onUnstage: (id: string) => void;
  onApplyAll: () => void;
  applying: boolean;
  onClose: () => void;
}

const OP_BADGE: Record<string, { label: string; className: string }> = {
  update: { label: "UPDATE", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40" },
  insert: { label: "INSERT", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40" },
  delete: { label: "DELETE", className: "bg-destructive/15 text-destructive border-destructive/40" },
};

/**
 * Rendered inside the right sidebar (Row Inspector area) to review & commit
 * staged row changes — mirrors the row editor panel's full-height layout.
 */
export function ReviewChangesPanel({ changes, onUnstage, onApplyAll, applying, onClose }: ReviewChangesPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">Review Changes</p>
          <p className="text-xs text-muted-foreground">{changes.length} pending change{changes.length !== 1 ? 's' : ''}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close"><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <ScrollArea className="flex-1 min-h-0 px-3">
        <div className="space-y-3 py-3">
          {changes.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">No staged changes to review.</p>
          ) : changes.map(change => {
            const op = change.op || "update";
            const badge = OP_BADGE[op];
            return (
              <div key={change.id} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className={cn("px-1.5 py-0 h-5 text-[10px] shrink-0", badge.className)}>{badge.label}</Badge>
                    <span className="text-xs font-medium text-muted-foreground truncate">
                      {op === "update"
                        ? `${change.schema}.${change.table}.${change.columnName}`
                        : op === "insert"
                          ? `INSERT row into ${change.schema}.${change.table}`
                          : `DELETE row from ${change.schema}.${change.table}`}
                    </span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onUnstage(change.id)} disabled={applying}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                {op === "update" && (
                  <div className="text-xs space-y-1 font-mono">
                    <div className="flex items-start gap-2 rounded bg-destructive/10 px-2 py-1">
                      <Minus className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
                      <span className="text-destructive line-through break-all">{String(change.originalValue ?? 'NULL')}</span>
                    </div>
                    <div className="flex items-start gap-2 rounded bg-success/10 px-2 py-1">
                      <Plus className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                      <span className="text-success break-all">{String(change.newValue ?? 'NULL')}</span>
                    </div>
                  </div>
                )}
                {op !== "update" && change.statement && (
                  <pre className="text-xs font-mono bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap">{change.statement.query}</pre>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <div className="border-t border-border p-3">
        <Button className="w-full" onClick={onApplyAll} disabled={applying || changes.length === 0}>
          {applying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
          {applying ? 'Applying...' : `Apply ${changes.length} Change${changes.length !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  );
}
