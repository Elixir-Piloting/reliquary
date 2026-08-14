"use client";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, Loader2, Star, Database, Shield, LogIn, Infinity as InfinityIcon, ChevronRight } from "lucide-react";
import API from "@/lib/ipc-client";
import type { RoleInfo } from "@/lib/db/types";
import { useRightSidebar } from "@/components/right-sidebar-context";
import { cn } from "@/lib/utils";

interface RolesPanelProps {
  connectionId: string;
}

export function RolesPanel({ connectionId }: RolesPanelProps) {
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<RoleInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rightSidebar = useRightSidebar();

  const openRoles = () => {
    setOpen(true);
    setRoles(null);
    setError(null);
    setLoading(true);
    API.getRoles(connectionId)
      .then(data => { setRoles(data); })
      .catch(e => { setError(String(e)); })
      .finally(() => { setLoading(false); });
  };

  // Push the panel into the right sidebar and refresh its content as the roles
  // load — the sidebar content is a captured element, so we re-render it here.
  useEffect(() => {
    if (!open) return;
    rightSidebar.openRight(
      <div className="flex h-full flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">Database Roles</p>
            <p className="text-xs text-muted-foreground">{roles?.length !== undefined ? `${roles.length} role${roles.length !== 1 ? "s" : ""}` : "Roles on the current database"}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setOpen(false); rightSidebar.closeRight(); }} title="Close"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="space-y-2 p-3 pb-4">
              {loading ? (
                <div className="py-8 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : error ? (
                <div className="py-6 text-center text-sm text-destructive px-4 break-words">{error}</div>
              ) : roles && roles.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No roles</div>
              ) : roles?.map(role => (
                <div key={role.roleName} className="border border-border rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="text-sm font-medium font-mono truncate">{role.roleName}</span>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {role.connectionLimit === -1 ? <InfinityIcon className="h-3.5 w-3.5 inline -mt-0.5" /> : role.connectionLimit} connections
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {role.superuser && (
                      <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                        <Star className="h-3 w-3" />Superuser
                      </Badge>
                    )}
                    {role.createdb && (
                      <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] gap-1">
                        <Database className="h-3 w-3" />Create DB
                      </Badge>
                    )}
                    {role.createrole && (
                      <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] gap-1">
                        <Shield className="h-3 w-3" />Create Role
                      </Badge>
                    )}
                    {role.login && (
                      <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] gap-1">
                        <LogIn className="h-3 w-3" />Login
                      </Badge>
                    )}
                    {role.connectionLimit === -1 && (
                      <Badge variant="outline" className={cn("px-1.5 py-0 h-5 text-[10px] text-muted-foreground")}>Unlimited</Badge>
                    )}
                  </div>
                  {role.memberOf.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Member of: <span className="font-mono text-foreground">{role.memberOf.join(", ")}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    );
  }, [open, roles, loading, error, connectionId, rightSidebar]);

  return (
    <Button variant="ghost" size="sm" onClick={openRoles} className="h-8 px-3 gap-2">
      <Users className="h-4 w-4" />
      <span className="text-sm font-medium">Roles</span>
    </Button>
  );
}
