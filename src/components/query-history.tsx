"use client";
import { useState, useEffect } from "react";
import { History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Persistence } from "@/lib/persistence";

interface QueryHistoryProps {
  connectionId: string;
  onSelect: (query: string) => void;
}

export function QueryHistory({ connectionId, onSelect }: QueryHistoryProps) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    if (open) setHistory(Persistence.getQueryHistory(connectionId));
  }, [open, connectionId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" title="Query history">
          <History className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">Query history</span>
          {history.length > 0 && (
            <button
              onClick={() => { Persistence.clearQueryHistory(connectionId); setHistory([]); }}
              className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" /> Clear all
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {history.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No query history yet</div>
          ) : (
            <div className="py-1">
              {history.map((q, i) => (
                <button
                  key={`${i}-${q}`}
                  onClick={() => { onSelect(q); setOpen(false); }}
                  title={q}
                  className="block w-full cursor-pointer truncate px-3 py-2 text-left font-mono text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
