"use client";
import { useState, useEffect } from "react";
import { History, Trash2, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Persistence, type QueryHistoryEntry } from "@/lib/persistence";
import { cn } from "@/lib/utils";

interface QueryHistoryProps {
  connectionId: string;
  onSelect: (query: string) => void;
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (isNaN(then.getTime())) return "";
  const now = new Date();
  const mins = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString();
}

export function QueryHistory({ connectionId, onSelect }: QueryHistoryProps) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);

  useEffect(() => {
    if (open) setHistory(Persistence.getQueryHistory(connectionId));
  }, [open, connectionId]);

  const togglePinned = (q: QueryHistoryEntry) => {
    Persistence.toggleQueryPinned(connectionId, q.query);
    setHistory(prev => prev.map(h => h.query === q.query ? { ...h, pinned: !h.pinned } : h));
  };

  const remove = (q: QueryHistoryEntry) => {
    Persistence.removeQueryFromHistory(connectionId, q.query);
    setHistory(prev => prev.filter(h => h.query !== q.query));
  };

  const pinned = history.filter(h => h.pinned);
  const unpinned = history.filter(h => !h.pinned);

  const renderRow = (entry: QueryHistoryEntry) => (
    <div key={entry.query} className="group flex items-center gap-1 pr-1">
      <button
        onClick={() => { onSelect(entry.query); setOpen(false); }}
        title={entry.query}
        className="block min-w-0 flex-1 cursor-pointer truncate px-3 py-2 text-left font-mono text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {entry.query}
      </button>
      {entry.addedAt && (
        <span className="shrink-0 text-[10px] text-muted-foreground/80">{formatTime(entry.addedAt)}</span>
      )}
      <button
        onClick={() => togglePinned(entry)}
        title={entry.pinned ? "Unpin" : "Pin"}
        className={cn("shrink-0 rounded p-1 text-muted-foreground/70 transition-colors", entry.pinned ? "text-amber-500 hover:text-amber-400" : "opacity-0 hover:text-foreground group-hover:opacity-100")}
      >
        {entry.pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
      </button>
      <button
        onClick={() => remove(entry)}
        title="Remove from history"
        className="shrink-0 rounded p-1 text-muted-foreground/70 opacity-0 transition-colors hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" title="Query history">
          <History className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
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
              {pinned.length > 0 && (
                <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Pinned</div>
              )}
              {pinned.map(renderRow)}
              {unpinned.length > 0 && (
                <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Recent</div>
              )}
              {unpinned.map(renderRow)}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}