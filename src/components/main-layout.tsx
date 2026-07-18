"use client";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { SchemaExplorer } from "@/components/schema-explorer";
import { SidebarProvider, useSidebar } from "@/components/sidebar-context";
import { cn } from "@/lib/utils";
import { getSubtleBackground } from "@/lib/utils/color";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { getConnections } from "@/lib/connections/store";
import { getProviderMetadata } from "@/lib/db/providers";
import { buildConnectionURL } from "@/lib/connections/url-parser";
import type { ConnectionConfig } from "@/lib/db/types";
import { ChevronDown, Home, Settings, Plus, Loader2, Pencil } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { invoke } from "@tauri-apps/api/core";

function ProviderIcon({ provider }: { provider: string }) {
  const meta = getProviderMetadata(provider as any);
  if (!meta) return <div className="w-4 h-4 rounded-sm bg-muted" />;
  return (
    <div className="relative w-4 h-4 shrink-0 rounded-sm flex items-center justify-center" style={{ backgroundColor: getSubtleBackground(meta.color, 1.0) }}>
      {meta.iconType === "image" ? (
        <img src={meta.icon} alt={meta.name} className="w-full h-full object-contain p-0.5"
          onError={e => { const p = e.currentTarget.parentElement; if (p) p.innerHTML = `<span class="text-[8px] font-bold" style="color: ${meta.color === '#FFFFFF' || meta.color === '#000000' ? '#1d1d1f' : '#fff'}">${meta.name.charAt(0)}</span>`; }} />
      ) : (
        <span className="text-[8px] font-bold" style={{ color: meta.color === "#FFFFFF" || meta.color === "#000000" ? "#1d1d1f" : "#fff" }}>{meta.name.charAt(0)}</span>
      )}
    </div>
  );
}

function MainLayoutContent({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { collapsed: sidebarCollapsed } = useSidebar();
  const [connectionsPopoverOpen, setConnectionsPopoverOpen] = useState(false);
  const [currentConnection, setCurrentConnection] = useState<ConnectionConfig | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connections = getConnections();

  useEffect(() => {
    if (connections.length > 0 && !currentConnection) {
      setCurrentConnection(connections[0]);
    }
  }, [connections]);

  const handleConnectionSelect = async (conn: ConnectionConfig) => {
    setConnecting(true);
    try {
      const url = conn.connectionString || buildConnectionURL({
        host: conn.host || "localhost",
        port: conn.port || 5432,
        database: conn.database || "",
        user: conn.user || "",
        password: conn.password || "",
        ssl: conn.ssl,
      });
      await invoke("connect", { connectionId: conn.id, url });
      setCurrentConnection(conn);
      setConnectionsPopoverOpen(false);
      navigate(`/db/${conn.id}`);
    } catch (e) {
      console.error("Connection failed", e);
    }
    setConnecting(false);
  };

  const handleTableSelect = (schema: string, table: string) => {
    if (currentConnection) navigate(`/db/${currentConnection.id}?table=${schema}.${table}`);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className={cn("border-r border-border flex flex-col transition-all duration-200 ease-in-out", sidebarCollapsed ? "w-0 overflow-hidden" : "w-64", "shrink-0")}>
        <div className="px-4 py-4 shrink-0">
          <Popover open={connectionsPopoverOpen} onOpenChange={setConnectionsPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between h-8 px-3 text-sm border-0 shadow-none focus:ring-0">
                {currentConnection ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <ProviderIcon provider={currentConnection.provider} />
                    <span className="truncate">{currentConnection.name}</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground truncate">Select connection</span>
                )}
                <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="start">
              <div className="max-h-[200px] overflow-y-auto">
                {connections.map(conn => (
                  <div key={conn.id} className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors group hover:bg-accent hover:text-accent-foreground", currentConnection?.id === conn.id && "bg-accent text-accent-foreground")}>
                    <button onClick={() => handleConnectionSelect(conn)} disabled={connecting}
                      className="flex items-center gap-2 min-w-0 flex-1">
                      <ProviderIcon provider={conn.provider} />
                      <span className="truncate">{conn.name}</span>
                      {connecting && <Loader2 className="h-3 w-3 animate-spin ml-auto" />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); navigate(`/add-connection/${conn.provider}?connectionId=${conn.id}`); setConnectionsPopoverOpen(false); }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-accent-foreground/10 rounded transition-opacity">
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {connections.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground text-center">No connections</p>}
              </div>
              <div className="border-t px-1 py-1">
                <button onClick={() => { setConnectionsPopoverOpen(false); navigate("/add-connection"); }}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent">
                  <Plus className="h-4 w-4" /> Add Connection
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <ScrollArea className="flex-1 p-4">
          <SchemaExplorer connectionId={currentConnection?.id} onTableSelect={handleTableSelect} />
        </ScrollArea>
        <div className="p-2 shrink-0">
          <TooltipProvider>
            <div className="flex space-x-2">
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="h-8 w-8"><Home className="h-4 w-4" /></Button>
              </TooltipTrigger><TooltipContent side="right"><p>Home</p></TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} className="h-8 w-8"><Settings className="h-4 w-4" /></Button>
              </TooltipTrigger><TooltipContent side="right"><p>Settings</p></TooltipContent></Tooltip>
            </div>
          </TooltipProvider>
        </div>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="h-10 border-b border-border flex items-center px-6 shrink-0 bg-muted/10">
          <Breadcrumbs />
        </div>
        {children}
      </div>
    </div>
  );
}

export function MainLayout({ children }: { children: React.ReactNode }) {
  return <SidebarProvider><MainLayoutContent>{children}</MainLayoutContent></SidebarProvider>;
}
