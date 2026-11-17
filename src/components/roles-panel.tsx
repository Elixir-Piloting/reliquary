"use client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import {
  Users, Loader2, Star, Database, Shield, LogIn, Infinity as InfinityIcon,
  ChevronRight, Plus, Pencil, Trash2, ChevronDown, ChevronUp, X,
} from "lucide-react";
import API from "@/lib/ipc-client";
import type { RoleInfo } from "@/lib/db/types";
import { useRightSidebar } from "@/components/right-sidebar-context";

interface RolesPanelProps {
  connectionId: string;
}

/** Quote an identifier so no injected string can break out of the SQL. */
const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** Quote a string literal (role passwords). */
const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

interface RoleForm {
  name: string;
  password: string;
  login: boolean;
  superuser: boolean;
  createdb: boolean;
  createrole: boolean;
  connectionLimit: number;
}

const EMPTY_FORM: RoleForm = { name: "", password: "", login: false, superuser: false, createdb: false, createrole: false, connectionLimit: -1 };

/** The WITH … clause shared by CREATE ROLE and ALTER ROLE. */
function roleOptionsSql(f: RoleForm): string {
  const parts = [
    f.login ? "LOGIN" : "NOLOGIN",
    f.superuser ? "SUPERUSER" : "NOSUPERUSER",
    f.createdb ? "CREATEDB" : "NOCREATEDB",
    f.createrole ? "CREATEROLE" : "NOCREATEROLE",
    `CONNECTION LIMIT ${f.connectionLimit}`,
  ];
  if (f.password) parts.push(`PASSWORD ${quoteLiteral(f.password)}`);
  return parts.join(" ");
}

function RoleFormDialog({ open, onOpenChange, mode, role, onSave }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "create" | "edit";
  role: RoleInfo | null;
  onSave: (form: RoleForm) => Promise<void>;
}) {
  const [form, setForm] = useState<RoleForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(role ? {
      name: role.roleName,
      password: "",
      login: role.login,
      superuser: role.superuser,
      createdb: role.createdb,
      createrole: role.createrole,
      connectionLimit: role.connectionLimit,
    } : EMPTY_FORM);
  }, [open, role]);

  const set = <K extends keyof RoleForm>(k: K, v: RoleForm[K]) => setForm(prev => ({ ...prev, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Role name is required"); return; }
    setBusy(true);
    try { await onSave(form); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create Role" : `Edit Role "${role?.roleName}"`}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "CREATE ROLE with the options below. A blank password creates a password-less role."
              : "ALTER ROLE with the options below. Leave password blank to keep the current one."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Role name</Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="role_name" disabled={mode === "edit"} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" value={form.password} onChange={e => set("password", e.target.value)} placeholder="blank = no password" className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label>Connection limit</Label>
            <Input type="number" value={String(form.connectionLimit)} onChange={e => set("connectionLimit", Number(e.target.value) || -1)} className="font-mono" />
            <p className="text-xs text-muted-foreground">Use -1 for unlimited.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            {([
              ["login", "Login", "Can connect to the database"],
              ["superuser", "Superuser", "Bypasses all permission checks"],
              ["createdb", "Create DB", "May create databases"],
              ["createrole", "Create Role", "May create/alter/drop roles"],
            ] as const).map(([key, label, hint]) => (
              <label key={key} className="flex items-start gap-2 cursor-pointer border border-border/70 rounded-md p-2.5">
                <Checkbox checked={form[key]} onCheckedChange={v => set(key, !!v)} className="mt-0.5" />
                <span className="text-xs leading-tight">
                  <span className="block font-medium">{label}</span>
                  <span className="block text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
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

const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "USAGE"] as const;
const OBJECT_TYPES = ["TABLE", "SCHEMA", "SEQUENCE", "FUNCTION"] as const;

/** `<TYPE> "schema"."object"` (schemas ignore the object name). */
function objectTarget(type: (typeof OBJECT_TYPES)[number], schema: string, object: string): string {
  if (type === "SCHEMA") return `SCHEMA ${quoteIdent(schema || "public")}`;
  return `${type} ${quoteIdent(schema || "public")}.${quoteIdent(object)}`;
}

function RoleCard({ role, roles, connectionId, onEdit, onDrop, reload }: {
  role: RoleInfo;
  roles: RoleInfo[];
  connectionId: string;
  onEdit: (r: RoleInfo) => void;
  onDrop: (r: RoleInfo) => void;
  reload: () => void;
}) {
  const [showPrivs, setShowPrivs] = useState(false);
  const [grantTo, setGrantTo] = useState("");
  const [objType, setObjType] = useState<(typeof OBJECT_TYPES)[number]>("TABLE");
  const [objSchema, setObjSchema] = useState("public");
  const [objName, setObjName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const runDdl = async (query: string, ok: string): Promise<boolean> => {
    setBusy(true);
    try {
      await invoke("execute_query", { connectionId, query, options: { confirmDestructive: true, readOnly: false } });
      toast.success(ok);
      return true;
    } catch (e: any) {
      toast.error("Failed", { description: String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const grantMembership = async () => {
    if (!grantTo) return;
    if (await runDdl(`GRANT ${quoteIdent(grantTo)} TO ${quoteIdent(role.roleName)};`, `Added "${role.roleName}" to "${grantTo}"`)) {
      setGrantTo("");
      reload();
    }
  };

  const revokeMembership = async (granted: string) => {
    if (await runDdl(`REVOKE ${quoteIdent(granted)} FROM ${quoteIdent(role.roleName)};`, `Removed "${role.roleName}" from "${granted}"`)) reload();
  };

  const togglePriv = (p: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });

  const privsText = picked.size === 0 ? "" : [...picked].join(", ");
  const canAct = objType !== "SCHEMA" ? (objName.trim() && privsText) : privsText;

  const grantPrivs = async () => {
    if (!canAct) return;
    const target = objectTarget(objType, objSchema, objName);
    if (await runDdl(`GRANT ${privsText} ON ${target} TO ${quoteIdent(role.roleName)};`, `Granted to "${role.roleName}"`)) reload();
  };

  const revokePrivs = async () => {
    if (!canAct) return;
    const target = objectTarget(objType, objSchema, objName);
    if (await runDdl(`REVOKE ${privsText} ON ${target} FROM ${quoteIdent(role.roleName)};`, `Revoked from "${role.roleName}"`)) reload();
  };

  const candidates = roles.filter(r => r.roleName !== role.roleName && !role.memberOf.includes(r.roleName));

  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-sm font-medium font-mono truncate">{role.roleName}</span>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums mr-1">
            {role.connectionLimit === -1 ? <InfinityIcon className="h-3.5 w-3.5 inline -mt-0.5" /> : role.connectionLimit} conn{role.connectionLimit === -1 ? "s" : ""}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => onEdit(role)} title="Edit role"><Pencil className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onDrop(role)} title="Drop role"><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {role.superuser && (
          <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
            <Star className="h-3 w-3" />Superuser
          </Badge>
        )}
        {role.createdb && (
          <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] gap-1"><Database className="h-3 w-3" />Create DB</Badge>
        )}
        {role.createrole && (
          <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] gap-1"><Shield className="h-3 w-3" />Create Role</Badge>
        )}
        {role.login && (
          <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] gap-1"><LogIn className="h-3 w-3" />Login</Badge>
        )}
      </div>

      {/* Membership */}
      <div className="space-y-1.5">
        {role.memberOf.length > 0 && (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <span>Member of:</span>
            {role.memberOf.map(m => (
              <span key={m} className="inline-flex items-center gap-1 font-mono text-foreground bg-muted/50 rounded px-1.5 py-0.5">
                {m}
                <button className="cursor-pointer hover:text-destructive" title="Revoke membership" onClick={() => revokeMembership(m)}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}
        {candidates.length > 0 && (
          <div className="flex items-center gap-2">
            <Select value={grantTo} onValueChange={setGrantTo}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Add to role…" /></SelectTrigger>
              <SelectContent>
                {candidates.map(r => <SelectItem key={r.roleName} value={r.roleName}>{r.roleName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={grantMembership} disabled={busy || !grantTo}>Grant</Button>
          </div>
        )}
      </div>

      {/* Object privileges */}
      <div>
        <button
          onClick={() => setShowPrivs(v => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        >
          {showPrivs ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Object privileges
        </button>
        {showPrivs && (
          <div className="mt-2 space-y-2 border border-border/60 rounded-md p-2">
            <div className="grid grid-cols-[6rem_1fr_1fr] gap-2">
              <Select value={objType} onValueChange={v => setObjType(v as typeof OBJECT_TYPES[number])}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{OBJECT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              <Input value={objSchema} onChange={e => setObjSchema(e.target.value)} placeholder="schema" className="h-7 text-xs font-mono" />
              <Input value={objName} onChange={e => setObjName(e.target.value)} placeholder={objType === "SCHEMA" ? "—" : "object"} disabled={objType === "SCHEMA"} className="h-7 text-xs font-mono" />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {PRIVILEGES.map(p => (
                <label key={p} className="flex items-center gap-1 text-xs cursor-pointer">
                  <Checkbox checked={picked.has(p)} onCheckedChange={() => togglePriv(p)} className="h-3.5 w-3.5" />
                  {p}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={grantPrivs} disabled={busy || !canAct}>GRANT</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={revokePrivs} disabled={busy || !canAct}>REVOKE</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function RolesPanel({ connectionId }: RolesPanelProps) {
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<RoleInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editRole, setEditRole] = useState<RoleInfo | null>(null);
  const [dropRole, setDropRole] = useState<RoleInfo | null>(null);
  const rightSidebar = useRightSidebar();

  const loadRoles = () => {
    setLoading(true);
    API.getRoles(connectionId)
      .then(data => { setRoles(data); setError(null); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  };

  const openRoles = () => {
    setOpen(true);
    setRoles(null);
    setError(null);
    loadRoles();
  };

  const runDdl = async (query: string, ok: string): Promise<boolean> => {
    try {
      await invoke("execute_query", { connectionId, query, options: { confirmDestructive: true, readOnly: false } });
      toast.success(ok);
      return true;
    } catch (e: any) {
      toast.error("Failed", { description: String(e) });
      return false;
    }
  };

  const handleCreate = async (form: RoleForm) => {
    if (await runDdl(`CREATE ROLE ${quoteIdent(form.name)} WITH ${roleOptionsSql(form)};`, `Role "${form.name}" created`)) {
      setShowCreate(false);
      loadRoles();
    }
  };

  const handleAlter = async (form: RoleForm) => {
    if (await runDdl(`ALTER ROLE ${quoteIdent(form.name)} WITH ${roleOptionsSql(form)};`, `Role "${form.name}" updated`)) {
      setEditRole(null);
      loadRoles();
    }
  };

  const handleDrop = async () => {
    if (!dropRole) return;
    if (await runDdl(`DROP ROLE IF EXISTS ${quoteIdent(dropRole.roleName)};`, `Role "${dropRole.roleName}" dropped`)) {
      setDropRole(null);
      loadRoles();
    }
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
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setShowCreate(true)} title="Create role"><Plus className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setOpen(false); rightSidebar.closeRight(); }} title="Close"><ChevronRight className="h-4 w-4" /></Button>
          </div>
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
                <RoleCard
                  key={role.roleName}
                  role={role}
                  roles={roles}
                  connectionId={connectionId}
                  onEdit={setEditRole}
                  onDrop={setDropRole}
                  reload={loadRoles}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    );
  }, [open, roles, loading, error, connectionId, rightSidebar]);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={openRoles} className="h-8 px-3 gap-2">
        <Users className="h-4 w-4" />
        <span className="text-sm font-medium">Roles</span>
      </Button>
      <RoleFormDialog open={showCreate} onOpenChange={setShowCreate} mode="create" role={null} onSave={handleCreate} />
      {editRole && (
        <RoleFormDialog open={!!editRole} onOpenChange={v => { if (!v) setEditRole(null); }} mode="edit" role={editRole} onSave={handleAlter} />
      )}
      <Dialog open={!!dropRole} onOpenChange={v => { if (!v) setDropRole(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Drop role?</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{dropRole?.roleName}</span> will be dropped. Roles that own objects or hold grants cannot be dropped until reassigned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button variant="destructive" onClick={handleDrop}>Drop role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}