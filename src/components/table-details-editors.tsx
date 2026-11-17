"use client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import type { TriggerInfo, FunctionInfo, RlsPolicyInfo } from "@/lib/db/types";

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Execute DDL through `execute_query` (destructive-confirmed). Success toast
 *  only when `okMsg` is non-empty, so drop-then-create edits don't toast twice. */
export async function runDdlSql(connectionId: string, query: string, okMsg?: string): Promise<boolean> {
  try {
    await invoke("execute_query", { connectionId, query, options: { confirmDestructive: true, readOnly: false } });
    if (okMsg) toast.success(okMsg);
    return true;
  } catch (e: any) {
    toast.error("Failed", { description: String(e) });
    return false;
  }
}

export const triggerDropSql = (schema: string, table: string, name: string) =>
  `DROP TRIGGER ${quoteIdent(name)} ON ${quoteIdent(schema)}.${quoteIdent(table)};`;
export const triggerToggleSql = (schema: string, table: string, name: string, enabled: boolean) =>
  `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} ${enabled ? "ENABLE" : "DISABLE"} TRIGGER ${quoteIdent(name)};`;
export const functionDropSql = (schema: string, name: string, args: string) =>
  `DROP FUNCTION ${quoteIdent(schema)}.${quoteIdent(name)}(${args});`;
export const policyDropSql = (schema: string, table: string, name: string) =>
  `DROP POLICY ${quoteIdent(name)} ON ${quoteIdent(schema)}.${quoteIdent(table)};`;
export const rlsToggleSql = (schema: string, table: string, enabled: boolean) =>
  `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} ${enabled ? "ENABLE" : "DISABLE"} ROW LEVEL SECURITY;`;

function SqlPreview({ sql }: { sql: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground font-medium">Generated SQL</Label>
      <pre className="text-[11px] font-mono bg-muted/70 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-foreground max-h-36 overflow-y-auto">{sql || "—"}</pre>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

const TRIGGER_TIMINGS = ["BEFORE", "AFTER", "INSTEAD OF"] as const;
const TRIGGER_EVENTS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;

export function TriggerDialog({ open, onOpenChange, mode, connectionId, schema, table, trigger, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "create" | "edit";
  connectionId: string;
  schema: string;
  table: string;
  trigger: TriggerInfo | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [timing, setTiming] = useState<string>("AFTER");
  const [events, setEvents] = useState<Set<string>>(new Set(["INSERT"]));
  const [forEachRow, setForEachRow] = useState(true);
  const [func, setFunc] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(trigger?.triggerName || "");
    const t = (trigger?.actionTiming || "").toUpperCase();
    setTiming(t.startsWith("INSTEAD") ? "INSTEAD OF" : t === "BEFORE" ? "BEFORE" : "AFTER");
    setEvents(new Set(trigger?.eventManipulation ? [trigger.eventManipulation.toUpperCase()] : ["INSERT"]));
    setForEachRow(true);
    setFunc(trigger?.actionStatement || "");
  }, [open, trigger]);

  const toggleEvent = (ev: string) => setEvents(prev => {
    const next = new Set(prev);
    if (next.has(ev)) next.delete(ev); else next.add(ev);
    return next;
  });

  const sql = `CREATE TRIGGER ${quoteIdent(name)} ${timing} ${[...events].join(" OR ")}\n` +
    `ON ${quoteIdent(schema)}.${quoteIdent(table)}\n` +
    `FOR EACH ${forEachRow ? "ROW" : "STATEMENT"} EXECUTE FUNCTION ${func};`;

  const submit = async () => {
    if (!name.trim()) { toast.error("Trigger name is required"); return; }
    if (events.size === 0) { toast.error("Pick at least one event"); return; }
    if (!func.trim()) { toast.error("Function is required (e.g. public.log_changes())"); return; }
    setBusy(true);
    try {
      let ok = true;
      if (mode === "edit") ok = await runDdlSql(connectionId, triggerDropSql(schema, table, name));
      if (ok) ok = await runDdlSql(connectionId, sql, mode === "create" ? `Trigger "${name}" created` : `Trigger "${name}" updated`);
      if (ok) { onOpenChange(false); onSaved(); }
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create Trigger" : `Edit Trigger "${trigger?.triggerName}"`}</DialogTitle>
          <DialogDescription>Fires {timing.toLowerCase()} the listed events on {schema}.{table}. Editing recreates the trigger.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Trigger name">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="trg_audit_changes" className="font-mono" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Timing">
              <Select value={timing} onValueChange={setTiming}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{TRIGGER_TIMINGS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Kind">
              <Select value={forEachRow ? "row" : "statement"} onValueChange={v => setForEachRow(v === "row")}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="row">FOR EACH ROW</SelectItem>
                  <SelectItem value="statement">FOR EACH STATEMENT</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Events">
            <div className="grid grid-cols-2 gap-2">
              {TRIGGER_EVENTS.map(ev => (
                <label key={ev} className="flex items-center gap-2 text-xs cursor-pointer border border-border/70 rounded-md p-2">
                  <Checkbox checked={events.has(ev)} onCheckedChange={() => toggleEvent(ev)} />
                  {ev}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Function">
            <Input value={func} onChange={e => setFunc(e.target.value)} placeholder="public.log_changes()" className="font-mono" />
          </Field>
        </div>
        <SqlPreview sql={sql} />
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={busy}>Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {mode === "create" ? "Create" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

const LANGUAGES = ["plpgsql", "sql", "plpython3u", "plperl", "plv8"] as const;
const VOLATILITIES = ["VOLATILE", "STABLE", "IMMUTABLE"] as const;

export function FunctionDialog({ open, onOpenChange, mode, connectionId, schema, fn, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "create" | "edit";
  connectionId: string;
  schema: string;
  fn: FunctionInfo | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [args, setArgs] = useState("");
  const [returns, setReturns] = useState("");
  const [language, setLanguage] = useState<string>("plpgsql");
  const [volatility, setVolatility] = useState<string>("VOLATILE");
  const [securityDefiner, setSecurityDefiner] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(fn?.functionName || "");
    setArgs(fn?.arguments || "");
    setReturns(fn?.returnType || "");
    setLanguage(fn?.language || "plpgsql");
    setVolatility(fn?.volatility || "VOLATILE");
    setSecurityDefiner(fn?.securityDefiner ?? false);
    setBody("");
  }, [open, fn]);

  const TAG = "$reliquary$";
  const sql = `CREATE OR REPLACE FUNCTION ${quoteIdent(schema)}.${quoteIdent(name)}(${args})\n` +
    `RETURNS ${returns}\n` +
    `LANGUAGE ${language} ${volatility}${securityDefiner ? " SECURITY DEFINER" : ""}\n` +
    `AS ${TAG}\n${body}\n${TAG};`;

  const submit = async () => {
    if (!name.trim()) { toast.error("Function name is required"); return; }
    if (!returns.trim()) { toast.error("RETURNS type is required"); return; }
    if (!body.trim()) { toast.error("Function body is empty"); return; }
    if (body.includes(TAG)) { toast.error(`Body cannot contain the ${TAG} marker`); return; }
    setBusy(true);
    try {
      let ok = true;
      if (mode === "edit") ok = await runDdlSql(connectionId, functionDropSql(schema, name, args));
      if (ok) ok = await runDdlSql(connectionId, sql, mode === "create" ? `Function "${name}" created` : `Function "${name}" updated`);
      if (ok) { onOpenChange(false); onSaved(); }
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create Function" : `Edit Function "${fn?.functionName}"`}</DialogTitle>
          <DialogDescription>CREATE OR REPLACE in schema {schema}. Editing replaces the function.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Function name">
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="fn_name" className="font-mono" />
            </Field>
            <Field label="Returns">
              <Input value={returns} onChange={e => setReturns(e.target.value)} placeholder="integer, text, trigger, TABLE(…)" className="font-mono" />
            </Field>
          </div>
          <Field label="Arguments (types only)">
            <Input value={args} onChange={e => setArgs(e.target.value)} placeholder="user_id bigint, note text" className="font-mono" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Language">
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Volatility">
              <Select value={volatility} onValueChange={setVolatility}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{VOLATILITIES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <label className="flex items-end gap-2 text-xs cursor-pointer pb-1">
              <Checkbox checked={securityDefiner} onCheckedChange={v => setSecurityDefiner(!!v)} />
              SECURITY DEFINER
            </label>
          </div>
          <Field label="Body">
            <Textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder={"BEGIN\n  RETURN NEW;\nEND;"}
              className="font-mono text-xs min-h-28"
            />
          </Field>
        </div>
        <SqlPreview sql={sql} />
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={busy}>Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {mode === "create" ? "Create" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// RLS policies
// ---------------------------------------------------------------------------

const POLICY_COMMANDS = ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"] as const;

export function PolicyDialog({ open, onOpenChange, mode, connectionId, schema, table, policy, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "create" | "edit";
  connectionId: string;
  schema: string;
  table: string;
  policy: RlsPolicyInfo | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState<string>("ALL");
  const [roles, setRoles] = useState("");
  const [permissive, setPermissive] = useState(true);
  const [usingExpr, setUsingExpr] = useState("");
  const [checkExpr, setCheckExpr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(policy?.policyName || "");
    setCommand((policy?.command || "ALL").toUpperCase());
    setRoles(policy?.roles.join(", ") || "");
    setPermissive(policy?.permissive ?? true);
    setUsingExpr(policy?.usingExpression || "");
    setCheckExpr(policy?.checkExpression || "");
  }, [open, policy]);

  const rolesClause = roles.split(",").map(r => r.trim()).filter(Boolean).map(quoteIdent).join(", ");
  const sql = [
    `CREATE POLICY ${quoteIdent(name)} ON ${quoteIdent(schema)}.${quoteIdent(table)}`,
    `AS ${permissive ? "PERMISSIVE" : "RESTRICTIVE"} FOR ${command}`,
    rolesClause ? `TO ${rolesClause}` : "",
    usingExpr.trim() ? `USING (${usingExpr})` : "",
    checkExpr.trim() ? `WITH CHECK (${checkExpr})` : "",
  ].filter(Boolean).join(" ") + ";";

  const submit = async () => {
    if (!name.trim()) { toast.error("Policy name is required"); return; }
    setBusy(true);
    try {
      let ok = true;
      if (mode === "edit") ok = await runDdlSql(connectionId, policyDropSql(schema, table, name));
      if (ok) ok = await runDdlSql(connectionId, sql, mode === "create" ? `Policy "${name}" created` : `Policy "${name}" updated`);
      if (ok) { onOpenChange(false); onSaved(); }
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create Policy" : `Edit Policy "${policy?.policyName}"`}</DialogTitle>
          <DialogDescription>Row security policy on {schema}.{table}. Editing recreates the policy.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Policy name">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="policy_name" className="font-mono" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mode">
              <Select value={permissive ? "PERMISSIVE" : "RESTRICTIVE"} onValueChange={v => setPermissive(v === "PERMISSIVE")}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERMISSIVE">PERMISSIVE</SelectItem>
                  <SelectItem value="RESTRICTIVE">RESTRICTIVE</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Command">
              <Select value={command} onValueChange={setCommand}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{POLICY_COMMANDS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Roles (comma-separated; blank = PUBLIC)">
            <Input value={roles} onChange={e => setRoles(e.target.value)} placeholder="app_user, analyst" className="font-mono" />
          </Field>
          <Field label="Using (expression)">
            <Textarea value={usingExpr} onChange={e => setUsingExpr(e.target.value)} placeholder="tenant_id = current_setting('app.tenant')::bigint" className="font-mono text-xs min-h-16" />
          </Field>
          <Field label="With check (expression, optional)">
            <Textarea value={checkExpr} onChange={e => setCheckExpr(e.target.value)} placeholder="NEW.amount > 0" className="font-mono text-xs min-h-16" />
          </Field>
        </div>
        <SqlPreview sql={sql} />
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={busy}>Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {mode === "create" ? "Create" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Generic delete confirm (shared by the three tabs)
// ---------------------------------------------------------------------------

export function DropDdlDialog({ open, onOpenChange, connectionId, sql, message, okMsg, onDone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connectionId: string;
  sql: string;
  message: string;
  okMsg: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      if (await runDdlSql(connectionId, sql, okMsg)) { onOpenChange(false); onDone(); }
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Confirm delete</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <pre className="text-[11px] font-mono bg-muted/70 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-foreground">{sql}</pre>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={busy}>Cancel</Button></DialogClose>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}