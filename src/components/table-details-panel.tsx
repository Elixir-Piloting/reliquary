"use client";
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Zap, Code2, ShieldCheck } from "lucide-react";
import API from "@/lib/ipc-client";
import type { TriggerInfo, FunctionInfo, RlsPolicyInfo } from "@/lib/db/types";
import { cn } from "@/lib/utils";

interface TableDetailsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  schema: string;
  table: string;
}

type TabId = "triggers" | "functions" | "rls";

interface TabState<T> { data: T[] | null; loading: boolean; error: string | null; }

const COMMAND_BADGE: Record<string, { label: string; className: string }> = {
  SELECT: { label: "SELECT", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/40" },
  INSERT: { label: "INSERT", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40" },
  UPDATE: { label: "UPDATE", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40" },
  DELETE: { label: "DELETE", className: "bg-destructive/15 text-destructive border-destructive/40" },
  ALL: { label: "ALL", className: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/40" },
};

function commandBadge(command: string) {
  return COMMAND_BADGE[command.toUpperCase()] ?? { label: command, className: "bg-muted text-muted-foreground border-border" };
}

function CodeBlock({ label, value }: { label?: string; value: string | null | undefined }) {
  return (
    <div className="space-y-0.5">
      {label && <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>}
      <pre className="text-xs font-mono bg-muted/70 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-foreground">{value || "—"}</pre>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

function LoadingState() {
  return (
    <div className="py-8 flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return <div className="py-6 text-center text-sm text-destructive px-4 break-words">{message}</div>;
}

export function TableDetailsPanel({ open, onOpenChange, connectionId, schema, table }: TableDetailsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("triggers");
  const [loaded, setLoaded] = useState<Set<TabId>>(new Set());
  const [triggers, setTriggers] = useState<TabState<TriggerInfo>>({ data: null, loading: false, error: null });
  const [functions, setFunctions] = useState<TabState<FunctionInfo>>({ data: null, loading: false, error: null });
  const [rls, setRls] = useState<TabState<RlsPolicyInfo>>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!open) return;
    setLoaded(new Set());
    setTriggers({ data: null, loading: false, error: null });
    setFunctions({ data: null, loading: false, error: null });
    setRls({ data: null, loading: false, error: null });
    setActiveTab("triggers");
  }, [open, connectionId, schema, table]);

  useEffect(() => {
    if (!open) return;
    if (loaded.has(activeTab)) return;
    let cancelled = false;
    const markLoaded = () => { if (!cancelled) setLoaded(prev => new Set(prev).add(activeTab)); };
    if (activeTab === "triggers") {
      setTriggers(prev => ({ ...prev, loading: true, error: null }));
      API.getTriggers(connectionId, schema, table)
        .then(data => { if (!cancelled) setTriggers({ data, loading: false, error: null }); markLoaded(); })
        .catch(e => { if (!cancelled) setTriggers({ data: null, loading: false, error: String(e) }); });
    } else if (activeTab === "functions") {
      setFunctions(prev => ({ ...prev, loading: true, error: null }));
      API.getFunctions(connectionId, schema)
        .then(data => { if (!cancelled) setFunctions({ data, loading: false, error: null }); markLoaded(); })
        .catch(e => { if (!cancelled) setFunctions({ data: null, loading: false, error: String(e) }); });
    } else {
      setRls(prev => ({ ...prev, loading: true, error: null }));
      API.getRlsPolicies(connectionId, schema, table)
        .then(data => { if (!cancelled) setRls({ data, loading: false, error: null }); markLoaded(); })
        .catch(e => { if (!cancelled) setRls({ data: null, loading: false, error: String(e) }); });
    }
    return () => { cancelled = true; };
  }, [open, activeTab, loaded, connectionId, schema, table]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[520px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Table Details</SheetTitle>
          <SheetDescription className="font-mono text-xs">{schema}.{table}</SheetDescription>
        </SheetHeader>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} className="mt-4 flex flex-col flex-1 min-h-0">
          <TabsList className="w-full justify-start h-9">
            <TabsTrigger value="triggers" className="gap-1.5"><Zap className="h-3.5 w-3.5" />Triggers</TabsTrigger>
            <TabsTrigger value="functions" className="gap-1.5"><Code2 className="h-3.5 w-3.5" />Functions</TabsTrigger>
            <TabsTrigger value="rls" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />RLS Policies</TabsTrigger>
          </TabsList>
          <div className="flex-1 min-h-0 mt-2 -mx-6 px-6">
            <ScrollArea className="h-full">
              <TabsContent value="triggers" className="mt-0">
                <div className="space-y-2 pb-4">
                  {triggers.loading ? <LoadingState />
                    : triggers.error ? <ErrorState message={triggers.error} />
                    : triggers.data && triggers.data.length === 0 ? <EmptyState>No triggers</EmptyState>
                    : triggers.data?.map(t => (
                      <div key={t.triggerName} className="border border-border rounded-lg p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">{t.triggerName}</span>
                          <Badge variant={t.enabled ? "default" : "outline"} className={cn("px-1.5 py-0 h-5 text-[10px] shrink-0", !t.enabled && "text-muted-foreground")}>
                            {t.enabled ? "ENABLED" : "DISABLED"}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">{t.actionTiming} {t.eventManipulation}</div>
                        <CodeBlock value={t.actionStatement} />
                      </div>
                    ))}
                </div>
              </TabsContent>
              <TabsContent value="functions" className="mt-0">
                <div className="space-y-2 pb-4">
                  {functions.loading ? <LoadingState />
                    : functions.error ? <ErrorState message={functions.error} />
                    : functions.data && functions.data.length === 0 ? <EmptyState>No functions</EmptyState>
                    : functions.data?.map(f => (
                      <div key={`${f.functionName}(${f.arguments})`} className="border border-border rounded-lg p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-sm font-medium font-mono text-xs truncate">{f.functionName}({f.arguments})</span>
                          <Badge variant="outline" className="px-1.5 py-0 h-5 text-[10px] shrink-0">{f.language}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">returns <span className="font-mono">{f.returnType}</span></div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px]">{f.volatility}</Badge>
                          {f.securityDefiner && (
                            <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">SECURITY DEFINER</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </TabsContent>
              <TabsContent value="rls" className="mt-0">
                <div className="space-y-2 pb-4">
                  {rls.loading ? <LoadingState />
                    : rls.error ? <ErrorState message={rls.error} />
                    : rls.data && rls.data.length === 0 ? <EmptyState>No RLS policies</EmptyState>
                    : rls.data?.map(p => {
                      const badge = commandBadge(p.command);
                      return (
                        <div key={p.policyName} className="border border-border rounded-lg p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium truncate">{p.policyName}</span>
                            <Badge variant="outline" className={cn("px-1.5 py-0 h-5 text-[10px] shrink-0", badge.className)}>{badge.label}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Roles: <span className="font-mono text-foreground">{p.roles.length > 0 ? p.roles.join(", ") : "PUBLIC"}</span>
                          </div>
                          <CodeBlock label="Using" value={p.usingExpression} />
                          <CodeBlock label="Check" value={p.checkExpression} />
                        </div>
                      );
                    })}
                </div>
              </TabsContent>
            </ScrollArea>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
