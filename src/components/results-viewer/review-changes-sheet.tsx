"use client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Check, Loader2 } from "lucide-react";
import type { PendingChange } from "./types";

interface ReviewChangesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: PendingChange[];
  onUnstage: (id: string) => void;
  onApplyAll: () => void;
  applying: boolean;
}

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
              {changes.map(change => (
                <div key={change.id} className="border border-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-muted-foreground truncate pr-2">
                      {change.schema}.{change.table}.{change.columnName}
                    </span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onUnstage(change.id)} disabled={applying}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="text-sm space-y-1 font-mono">
                    <div className="text-muted-foreground line-through text-xs">{String(change.originalValue ?? 'NULL')}</div>
                    <div className="text-foreground text-xs">{String(change.newValue ?? 'NULL')}</div>
                  </div>
                </div>
              ))}
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
