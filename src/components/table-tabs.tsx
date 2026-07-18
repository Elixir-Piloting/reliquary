"use client";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TableTab {
  id: string;
  schema: string;
  table: string;
  label: string;
  type?: "view" | "create";
}

interface TableTabsProps {
  tabs: TableTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
}

export function TableTabs({ tabs, activeTabId, onTabSelect, onTabClose }: TableTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-2 border-b border-border bg-muted/20 overflow-x-auto">
      {tabs.map(tab => (
        <div key={tab.id} className={cn("group flex items-center gap-2 px-3 py-2 text-sm rounded-t-lg transition-colors relative hover:bg-accent/50",
          activeTabId === tab.id ? "bg-background border-t border-x border-border text-foreground font-medium" : "text-muted-foreground"
        )}>
          <button onClick={() => onTabSelect(tab.id)} className="flex-1 flex items-center gap-2 text-left">
            <span className="whitespace-nowrap">{tab.label}</span>
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
