"use client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { X, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PendingChange } from "./types";

interface ReviewChangesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: PendingChange[];
  onUnstage: (id: string) => void;
  onApplyAll: () => void;
  applying: boolean;
}

const OP_BADGE: Record<string, { label: string; className: string }> = {
  update: { label: "UPDATE", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40" },
  insert: { label: "INSERT", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40" },
  delete: { label: "DELETE", className: "bg-destructive/15 text-destructive border-destructive/40" },
};

export function ReviewChangesSheet({ open, onOpenChange, changes, onUnstage, onApplyAll, applying }: ReviewChangesSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[480px]">
        <SheetHeader>
          <SheetTitle>Review Changes</SheetTitle>
          <SheetDescription>{changes.length} pending change{changes.length !== 1 ? 's' : ''}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col flex-1 min-h-0 mt-4">
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-3 pb-4">
              {changes.map(change => {
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
                      <div className="text-sm space-y-1 font-mono">
                        <div className="text-muted-foreground line-through text-xs">{String(change.originalValue ?? 'NULL')}</div>
                        <div className="text-foreground text-xs">{String(change.newValue ?? 'NULL')}</div>
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
          <div className="border-t border-border pt-4">
            <Button className="w-full" onClick={onApplyAll} disabled={applying || changes.length === 0}>
              {applying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              {applying ? 'Applying...' : `Apply ${changes.length} Change${changes.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
