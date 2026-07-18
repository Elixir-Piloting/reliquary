"use client";
import { useNavigate, useLocation } from "react-router-dom";
import { Code2, Table2, Network, PanelLeft, PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/sidebar-context";

interface DatabaseNavbarProps { connectionId: string; }

export function DatabaseNavbar({ connectionId }: DatabaseNavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebar();

  const navItems = [
    { id: "query", label: "Query", icon: Code2, path: `/db/${connectionId}/query` },
    { id: "tables", label: "Tables", icon: Table2, path: `/db/${connectionId}` },
    { id: "visualizer", label: "Schema Visualizer", icon: Network, path: `/db/${connectionId}/visualizer` },
  ];

  const isActive = (path: string) => {
    if (path === `/db/${connectionId}`) return location.pathname === path;
    return location.pathname === path;
  };

  return (
    <div className="h-12 border-b border-border bg-muted/20 flex items-center px-4 gap-1 shrink-0">
      <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-8 w-8 mr-1"
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </Button>
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.path);
        return (
          <Button key={item.id} variant={active ? "secondary" : "ghost"} size="sm"
            onClick={() => navigate(item.path)}
            className={cn("h-8 px-3 gap-2", active && "bg-accent text-accent-foreground")}>
            <Icon className="h-4 w-4" />
            <span className="text-sm font-medium">{item.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
