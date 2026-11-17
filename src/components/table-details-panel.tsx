"use client";
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Zap, Code2, ShieldCheck, Pencil, Trash2, Plus } from "lucide-react";
import API from "@/lib/ipc-client";
import type { TriggerInfo, FunctionInfo, RlsPolicyInfo } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import {
  TriggerDialog, FunctionDialog, PolicyDialog, DropDdlDialog,
  runDdlSql, triggerDropSql, triggerToggleSql, functionDropSql, policyDropSql, rlsToggleSql,
} from "@/components/table-details-editors";

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

interface DropTarget { sql: string; message: string; okMsg: string; }

export function TableDetailsPanel({ open, onOpenChange, connectionId, schema, table }: TableDetailsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("triggers");
  const [loaded, setLoaded] = useState<Set<TabId>>(new Set());
  const [triggers, setTriggers] = useState<TabState<TriggerInfo>>({ data: null, loading: false, error: null });
  const [functions, setFunctions] = useState<TabState<FunctionInfo>>({ data: null, loading: false, error: null });
  const [rls, setRls] = useState<TabState<RlsPolicyInfo>>({ data: null, loading: false, error: null });
  const [rlsStatus, setRlsStatus] = useState<boolean | null>(null);

  const [triggerDlg, setTriggerDlg] = useState<{ mode: "create" | "edit"; trigger?: TriggerInfo } | null>(null);
  const [fnDlg, setFnDlg] = useState<{ mode: "create" | "edit"; fn?: FunctionInfo } | null>(null);
  const [policyDlg, setPolicyDlg] = useState<{ mode: "create" | "edit"; policy?: RlsPolicyInfo } | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoaded(new Set());
    setTriggers({ data: null, loading: false, error: null });
    setFunctions({ data: null, loading: false, error: null });
    setRls({ data: null, loading: false, error: null });
    setRlsStatus(null);
    setActiveTab("triggers");
    setTriggerDlg(null); setFnDlg(null); setPolicyDlg(null); setDrop(null);
  }, [open, connectionId, schema, table]);

  const refetchTriggers = () => {
    API.getTriggers(connectionId, schema, table)
      .then(data => setTriggers({ data, loading: false, error: null }))
      .catch(e => setTriggers({ data: null, loading: false, error: String(e) }));
  };
  const refetchFunctions = () => {
    API.getFunctions(connectionId, schema)
      .then(data => setFunctions({ data, loading: false, error: null }))
      .catch(e => setFunctions({ data: null, loading: false, error: String(e) }));
  };
  const refetchRls = () => {
    Promise.all([
      API.getRlsPolicies(connectionId, schema, table),
      API.tableRlsStatus(connectionId, schema, table),
    ])
      .then(([policies, status]) => { setRls({ data: policies, loading: false, error: null }); setRlsStatus(status); })
      .catch(e => setRls(prev => ({ ...prev, error: String(e) })));
  };

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
      Promise.all([
        API.getRlsPolicies(connectionId, schema, table),
        API.tableRlsStatus(connectionId, schema, table),
      ])
        .then(([policies, status]) => { if (!cancelled) { setRls({ data: policies, loading: false, error: null }); setRlsStatus(status); } markLoaded(); })
        .catch(e => { if (!cancelled) setRls({ data: null, loading: false, error: String(e) }); });
    }
    return () => { cancelled = true; };
  }, [open, activeTab, loaded, connectionId, schema, table]);

  const toggleTrigger = async (t: TriggerInfo) => {
    if (await runDdlSql(connectionId, triggerToggleSql(schema, table, t.triggerName, !t.enabled), `Trigger "${t.triggerName}" ${t.enabled ? "disabled" : "enabled"}`)) {
      refetchTriggers();
    }
  };

  const toggleRls = async (enabled: boolean) => {
    if (rlsStatus === null) return;
    const prev = rlsStatus;
    setRlsStatus(null);
    if (await runDdlSql(connectionId, rlsToggleSql(schema, table, enabled), `Row level security ${enabled ? "enabled" : "disabled"}`)) {
      refetchRls();
    } else {
      setRlsStatus(prev);
    }
  };

  const iconBtn = "h-7 w-7 text-muted-foreground hidden group-hover:flex";
  const cardCls = "border border-border rounded-lg p-3 space-y-1.5 group";

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
                  <div className="flex items-center justify-end pb-1">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setTriggerDlg({ mode: "create" })}>
                      <Plus className="h-3.5 w-3.5 mr-1" />New Trigger
                    </Button>
                  </div>
                  {triggers.loading ? <LoadingState />
                    : triggers.error ? <ErrorState message={triggers.error} />
                    : triggers.data && triggers.data.length === 0 ? <EmptyState>No triggers</EmptyState>
                    : triggers.data?.map(t => (
                      <div key={t.triggerName} className={cardCls}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">{t.triggerName}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => toggleTrigger(t)}
                              title={t.enabled ? "Disable trigger" : "Enable trigger"}
                              className={cn(
                                "px-1.5 py-0 h-5 text-[10px] rounded-md border border-border/60 cursor-pointer transition-colors",
                                t.enabled ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                              )}
                            >
                              {t.enabled ? "ENABLED" : "DISABLED"}
                            </button>
                            <Button variant="ghost" size="icon" className={cn(iconBtn)} onClick={() => setTriggerDlg({ mode: "edit", trigger: t })} title="Edit trigger"><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className={cn(iconBtn, "hover:text-destructive")} onClick={() => setDrop({ sql: triggerDropSql(schema, table, t.triggerName), message: `Drop trigger "${t.triggerName}"?`, okMsg: `Trigger "${t.triggerName}" dropped` })} title="Drop trigger"><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">{t.actionTiming} {t.eventManipulation}</div>
                        <CodeBlock value={t.actionStatement} />
                      </div>
                    ))}
                </div>
              </TabsContent>
              <TabsContent value="functions" className="mt-0">
                <div className="space-y-2 pb-4">
                  <div className="flex items-center justify-end pb-1">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFnDlg({ mode: "create" })}>
                      <Plus className="h-3.5 w-3.5 mr-1" />New Function
                    </Button>
                  </div>
                  {functions.loading ? <LoadingState />
                    : functions.error ? <ErrorState message={functions.error} />
                    : functions.data && functions.data.length === 0 ? <EmptyState>No functions</EmptyState>
                    : functions.data?.map(f => (
                      <div key={`${f.functionName}(${f.arguments})`} className={cardCls}>
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-sm font-medium font-mono text-xs truncate">{f.functionName}({f.arguments})</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="outline" className="px-1.5 py-0 h-5 text-[10px]">{f.language}</Badge>
                            <Button variant="ghost" size="icon" className={cn(iconBtn)} onClick={() => setFnDlg({ mode: "edit", fn: f })} title="Edit function"><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className={cn(iconBtn, "hover:text-destructive")} onClick={() => setDrop({ sql: functionDropSql(schema, f.functionName, f.arguments), message: `Drop function "${f.functionName}"?`, okMsg: `Function "${f.functionName}" dropped` })} title="Drop function"><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
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
                  <div className="flex items-center justify-between border border-border/70 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">Row Level Security</p>
                      <p className="text-xs text-muted-foreground truncate">{rlsStatus === null ? "Loading…" : rlsStatus ? "Enabled on this table" : "Disabled on this table"}</p>
                    </div>
                    <Switch checked={rlsStatus === true} onCheckedChange={toggleRls} disabled={rlsStatus === null} />
                  </div>
                  <div className="flex items-center justify-end pb-1">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPolicyDlg({ mode: "create" })}>
                      <Plus className="h-3.5 w-3.5 mr-1" />New Policy
                    </Button>
                  </div>
                  {rls.loading ? <LoadingState />
                    : rls.error ? <ErrorState message={rls.error} />
                    : rls.data && rls.data.length === 0 ? <EmptyState>No RLS policies</EmptyState>
                    : rls.data?.map(p => {
                      const badge = commandBadge(p.command);
                      return (
                        <div key={p.policyName} className={cardCls}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium truncate">{p.policyName}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <Badge variant="outline" className={cn("px-1.5 py-0 h-5 text-[10px]", badge.className)}>{badge.label}</Badge>
                              <Badge variant="outline" className="px-1.5 py-0 h-5 text-[10px] text-muted-foreground">{p.permissive ? "PERMISSIVE" : "RESTRICTIVE"}</Badge>
                              <Button variant="ghost" size="icon" className={cn(iconBtn)} onClick={() => setPolicyDlg({ mode: "edit", policy: p })} title="Edit policy"><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button variant="ghost" size="icon" className={cn(iconBtn, "hover:text-destructive")} onClick={() => setDrop({ sql: policyDropSql(schema, table, p.policyName), message: `Drop policy "${p.policyName}"?`, okMsg: `Policy "${p.policyName}" dropped` })} title="Drop policy"><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
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

      {triggerDlg && (
        <TriggerDialog
          open={!!triggerDlg}
          onOpenChange={v => { if (!v) setTriggerDlg(null); }}
          mode={triggerDlg.mode}
          trigger={triggerDlg.trigger ?? null}
          connectionId={connectionId}
          schema={schema}
          table={table}
          onSaved={() => { refetchTriggers(); setTriggerDlg(null); }}
        />
      )}
      {fnDlg && (
        <FunctionDialog
          open={!!fnDlg}
          onOpenChange={v => { if (!v) setFnDlg(null); }}
          mode={fnDlg.mode}
          fn={fnDlg.fn ?? null}
          connectionId={connectionId}
          schema={schema}
          onSaved={() => { refetchFunctions(); setFnDlg(null); }}
        />
      )}
      {policyDlg && (
        <PolicyDialog
          open={!!policyDlg}
          onOpenChange={v => { if (!v) setPolicyDlg(null); }}
          mode={policyDlg.mode}
          policy={policyDlg.policy ?? null}
          connectionId={connectionId}
          schema={schema}
          table={table}
          onSaved={() => { refetchRls(); setPolicyDlg(null); }}
        />
      )}
      {drop && (
        <DropDdlDialog
          open={!!drop}
          onOpenChange={v => { if (!v) setDrop(null); }}
          connectionId={connectionId}
          sql={drop.sql}
          message={drop.message}
          okMsg={drop.okMsg}
          onDone={() => {
            if (activeTab === "triggers") refetchTriggers();
            else if (activeTab === "functions") refetchFunctions();
            else refetchRls();
            setDrop(null);
          }}
        />
      )}
    </Sheet>
  );
}