"use client";
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Code2, Table, Network, PanelLeft, PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Persistence } from "@/lib/persistence";
import { useSidebar } from "@/components/sidebar-context";
import { useConnections } from "@/lib/query/hooks/use-connections";
import { RolesPanel } from "@/components/roles-panel";
import { NeonBranchSwitcher } from "@/components/neon-branch-switcher";
import API from "@/lib/ipc-client";
import type { ConnectionInfo } from "@/lib/ipc-client";
import { onBranchSwitched } from "@/lib/branch-events";

interface DatabaseNavbarProps { connectionId: string; }

const PROVIDER_BADGES: Record<string, { label: string; dot: string; text: string; ring: string }> = {
  neon: { label: "Neon", dot: "bg-[#7C3AED]", text: "text-[#7C3AED]", ring: "border-[#7C3AED]/30 bg-[#7C3AED]/10" },
  supabase: { label: "Supabase", dot: "bg-[#3ECF8E]", text: "text-[#3ECF8E]", ring: "border-[#3ECF8E]/30 bg-[#3ECF8E]/10" },
  postgresql: { label: "PostgreSQL", dot: "bg-[#336791]", text: "text-[#336791]", ring: "border-[#336791]/30 bg-[#336791]/10" },
};

function ProviderBadge({ provider }: { provider?: string }) {
  const style = PROVIDER_BADGES[provider || "postgresql"] ?? PROVIDER_BADGES.postgresql;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0", style.ring, style.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {style.label}
    </span>
  );
}

export function DatabaseNavbar({ connectionId }: DatabaseNavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebar();
  const { data: connections = [] } = useConnections();
  const [connInfo, setConnInfo] = useState<ConnectionInfo | null>(null);

  const loadConnectionInfo = useCallback(() => {
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
    { id: "query", label: "Query", icon: Code2, path: `/db/${connectionId}/query` },
    { id: "tables", label: "Tables", icon: Table, path: `/db/${connectionId}` },
    { id: "visualizer", label: "Schema Visualizer", icon: Network, path: `/db/${connectionId}/visualizer` },
  ];

  const handleNavClick = (path: string, view: string) => {
    Persistence.setActiveView(connectionId, view);
    navigate(path);
  };

  const isActive = (path: string) => {
    if (path === `/db/${connectionId}`) {
      return location.pathname === path || location.pathname.startsWith(`${path}/table`);
    }
    return location.pathname === path;
  };

  const storedConn = connections.find(c => c.id === connectionId);
  const provider = connInfo?.isNeon ? "neon" : connInfo?.isSupabase ? "supabase" : connInfo?.provider || storedConn?.provider || "postgresql";
  const databaseName = connInfo?.database || storedConn?.name;

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
            onClick={() => handleNavClick(item.path, item.id)}
            className={cn("h-8 px-3 gap-2", active && "bg-accent text-accent-foreground")}>
            <Icon className="h-4 w-4" />
            <span className="text-sm font-medium">{item.label}</span>
          </Button>
        );
      })}
      <div className="flex-1" />
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-2 mr-1">
          <ProviderBadge provider={provider} />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground truncate max-w-[200px] cursor-default">
                {databaseName}
                {connInfo && <span className="text-muted-foreground/70"> · {connInfo.user}@{connInfo.host}</span>}
              </span>
            </TooltipTrigger>
            {connInfo && (
              <TooltipContent>
                <p className="font-mono text-xs">{connInfo.user}@{connInfo.host}:{connInfo.port}/{connInfo.database}</p>
                <p className="font-mono text-xs mt-0.5">{connInfo.serverVersion} · sslmode={connInfo.sslmode}</p>
                {connInfo.readOnly && <p className="text-xs mt-0.5 text-amber-400">Read-only mode</p>}
              </TooltipContent>
            )}
          </Tooltip>
        </div>
        {connectionId && connInfo?.isNeon && (
          <NeonBranchSwitcher connectionId={connectionId} readOnly={connInfo.readOnly} />
        )}
      </TooltipProvider>
      {connectionId && <RolesPanel connectionId={connectionId} />}
    </div>
  );
}
