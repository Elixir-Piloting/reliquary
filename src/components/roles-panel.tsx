"use client";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, Loader2, Star, Database, Shield, LogIn, Infinity as InfinityIcon } from "lucide-react";
import API from "@/lib/ipc-client";
import type { RoleInfo } from "@/lib/db/types";
import { cn } from "@/lib/utils";

interface RolesPanelProps {
  connectionId: string;
}

export function RolesPanel({ connectionId }: RolesPanelProps) {
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<RoleInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setLoading(true);
      setError(null);
      API.getRoles(connectionId)
        .then(data => setRoles(data))
        .catch(e => setError(String(e)))
        .finally(() => setLoading(false));
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => handleOpenChange(true)} className="h-8 px-3 gap-2">
        <Users className="h-4 w-4" />
        <span className="text-sm font-medium">Roles</span>
      </Button>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="w-[400px] sm:w-[480px] flex flex-col">
          <SheetHeader>
            <SheetTitle>Database Roles</SheetTitle>
            <SheetDescription>{roles?.length !== undefined ? `${roles.length} role${roles.length !== 1 ? "s" : ""}` : "Roles on the current database"}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0 mt-4 -mx-6 px-6">
            <ScrollArea className="h-full">
              <div className="space-y-2 pb-4">
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
        </SheetContent>
      </Sheet>
    </>
  );
}
