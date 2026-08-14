"use client";
import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceTab } from "@/lib/workspace-tabs";

interface DbTabsProps {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabRename: (tabId: string, newLabel: string) => void;
}

export function DbTabs({ tabs, activeTabId, onTabSelect, onTabClose, onTabRename }: DbTabsProps) {
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingTabId]);

  if (tabs.length === 0) return null;

  const tabColor = (tab: WorkspaceTab) =>
    tab.kind === "create" ? "text-blue-500"
    : tab.kind === "edit" ? "text-amber-500"
    : tab.kind === "query" ? "text-emerald-600"
    : tab.kind === "visualizer" ? "text-violet-500"
    : undefined;

  return (
    <div className="flex items-center border-b border-border bg-muted/20 overflow-x-auto shrink-0">
      {tabs.map(tab => (
        <div key={tab.id} className={cn("group flex items-center gap-2 px-3 py-2 text-sm transition-colors relative hover:bg-accent/50 border-t border-x border-border",
          activeTabId === tab.id ? "bg-background text-foreground font-medium" : "text-muted-foreground"
        )}>
          <button
            onClick={() => onTabSelect(tab.id)}
            onDoubleClick={e => { if (tab.kind === "query") { e.preventDefault(); e.stopPropagation(); setRenamingTabId(tab.id); setRenameValue(tab.label); } }}
            className="flex-1 flex items-center gap-2 text-left"
          >
            {renamingTabId === tab.id ? (
              <input ref={inputRef} type="text" value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={() => { if (renameValue.trim()) onTabRename(renamingTabId, renameValue.trim()); setRenamingTabId(null); setRenameValue(""); }}
                onKeyDown={e => { if (e.key === "Enter") { if (renameValue.trim()) onTabRename(renamingTabId, renameValue.trim()); setRenamingTabId(null); setRenameValue(""); } if (e.key === "Escape") { setRenamingTabId(null); setRenameValue(""); } }}
                onClick={e => e.stopPropagation()}
                className="bg-background border border-border rounded px-1 py-0.5 text-sm min-w-[60px] max-w-[200px]"
              />
            ) : (
              <span className={cn("whitespace-nowrap", tabColor(tab))}>{tab.label}</span>
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
