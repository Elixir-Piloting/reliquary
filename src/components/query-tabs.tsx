"use client";
import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QueryTab {
  id: string;
  label: string;
  query: string;
}

interface QueryTabsProps {
  tabs: QueryTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabRename: (tabId: string, newLabel: string) => void;
}

export function QueryTabs({ tabs, activeTabId, onTabSelect, onTabClose, onTabRename }: QueryTabsProps) {
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingTabId]);

  const handleDoubleClick = (tabId: string, currentLabel: string) => {
    setRenamingTabId(tabId);
    setRenameValue(currentLabel);
  };

  const handleRenameSubmit = (tabId: string) => {
    if (renameValue.trim()) onTabRename(tabId, renameValue.trim());
    setRenamingTabId(null);
    setRenameValue("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, tabId: string) => {
    if (e.key === "Enter") handleRenameSubmit(tabId);
    else if (e.key === "Escape") { setRenamingTabId(null); setRenameValue(""); }
  };

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-2 border-b border-border bg-muted/20 overflow-x-auto">
      {tabs.map(tab => (
        <div key={tab.id} className={cn("group flex items-center gap-2 px-3 py-2 text-sm rounded-t-lg transition-colors relative hover:bg-accent/50",
          activeTabId === tab.id ? "bg-background border-t border-x border-border text-foreground font-medium" : "text-muted-foreground"
        )}>
          <button onClick={() => onTabSelect(tab.id)}
            onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); handleDoubleClick(tab.id, tab.label); }}
            className="flex-1 flex items-center gap-2 text-left">
            {renamingTabId === tab.id ? (
              <input ref={inputRef} type="text" value={renameValue} onChange={e => setRenameValue(e.target.value)}
                onBlur={() => handleRenameSubmit(tab.id)} onKeyDown={e => handleRenameKeyDown(e, tab.id)}
                onClick={e => e.stopPropagation()}
                className="bg-background border border-border rounded px-1 py-0.5 text-sm min-w-[60px] max-w-[200px]" />
            ) : (
              <span className="whitespace-nowrap">{tab.label}</span>
            )}
          </button>
          <span className="h-4 w-4 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive cursor-pointer flex items-center justify-center rounded transition-colors"
            onClick={e => { e.stopPropagation(); onTabClose(tab.id); }} title="Close tab">
            <X className="h-3 w-3" />
          </span>
        </div>
      ))}
    </div>
  );
}
