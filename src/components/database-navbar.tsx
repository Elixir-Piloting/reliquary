"use client";
import { useState, useEffect, useCallback } from "react";
import { Code2, Network, PanelLeft, PanelLeftClose, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebar } from "@/components/sidebar-context";
import { useRightSidebar } from "@/components/right-sidebar-context";
import { RolesPanel } from "@/components/roles-panel";
import { NeonBranchSwitcher } from "@/components/neon-branch-switcher";
import API from "@/lib/ipc-client";
import type { ConnectionInfo } from "@/lib/ipc-client";
import { onBranchSwitched } from "@/lib/branch-events";

interface DatabaseNavbarProps {
  connectionId: string;
  activeView?: "tables" | "query" | "visualizer";
  onOpenQuery?: () => void;
  onOpenVisualizer?: () => void;
}

export function DatabaseNavbar({ connectionId, activeView, onOpenQuery, onOpenVisualizer }: DatabaseNavbarProps) {
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebar();
  const rightSidebar = useRightSidebar();
  const [connInfo, setConnInfo] = useState<ConnectionInfo | null>(null);

  const loadConnectionInfo = useCallback(() => {
    setConnInfo(null);
    if (!connectionId) return;
    let cancelled = false;
    API.getConnectionInfo(connectionId)
      .then(info => { if (!cancelled) setConnInfo(info); })
      .catch(() => { if (!cancelled) setConnInfo(null); });
    return () => { cancelled = true; };
  }, [connectionId]);

  useEffect(loadConnectionInfo, [loadConnectionInfo]);

  useEffect(() => {
    return onBranchSwitched(() => { setConnInfo(null); loadConnectionInfo(); });
  }, [loadConnectionInfo]);

  const navItems = [
    { id: "query", label: "SQL Query", icon: Code2, onClick: onOpenQuery },
    { id: "visualizer", label: "Schema Visualizer", icon: Network, onClick: onOpenVisualizer },
  ];

  return (
    <div className="h-12 border-b border-border bg-muted/20 flex items-center px-4 gap-1 shrink-0">
      <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-8 w-8 mr-1"
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </Button>
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = activeView === item.id;
        if (item.id === "visualizer") {
          return (
            <TooltipProvider key={item.id} delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant={active ? "secondary" : "ghost"} size="icon" onClick={item.onClick}
                    className={cn("h-8 w-8", active && "bg-accent text-accent-foreground")} aria-label={item.label}>
                    <Icon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>{item.label}</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        }
        return (
          <Button key={item.id} variant={active ? "secondary" : "ghost"} size="sm"
            onClick={item.onClick}
            className={cn("h-8 px-3 gap-2", active && "bg-accent text-accent-foreground")}>
            <Icon className="h-4 w-4" />
            <span className="text-sm font-medium">{item.label}</span>
          </Button>
        );
      })}
      <div className="flex-1" />
      <TooltipProvider delayDuration={300}>
        {connectionId && connInfo?.isNeon && (
          <NeonBranchSwitcher connectionId={connectionId} readOnly={connInfo.readOnly} />
        )}
      </TooltipProvider>
      {connectionId && <RolesPanel connectionId={connectionId} />}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => rightSidebar.setOpen(!rightSidebar.open)}
              aria-label={rightSidebar.open ? "Close editor" : "Open editor"}>
              {rightSidebar.open ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{rightSidebar.open ? "Close editor" : "Open editor"}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
