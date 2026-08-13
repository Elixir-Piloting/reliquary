"use client";
import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { POSTGRESQL_PROVIDER } from "@/lib/db/providers";
import { parseConnectionURL, buildConnectionURL, withSslMode } from "@/lib/connections/url-parser";
import { useConnections, useAddConnection, useUpdateConnection } from "@/lib/query/hooks/use-connections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SSL_MODES = ["disable", "prefer", "require", "verify-full"] as const;

export default function AddConnectionFormPage() {
  const { provider } = useParams<{ provider: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const editId = searchParams.get("connectionId");
  const connString = searchParams.get("connectionString");

  const { data: connections = [] } = useConnections();
  const addConnectionMutation = useAddConnection();
  const updateConnectionMutation = useUpdateConnection();

  const editingConn = editId ? connections.find(c => c.id === editId) : undefined;

  const [form, setForm] = useState({
    name: "",
    host: "",
    port: String(POSTGRESQL_PROVIDER.defaultPort),
    database: "",
    user: "",
    password: "",
    connectionString: connString || "",
    sslmode: "prefer",
    readOnly: false,
  });

  const isEditing = !!editId;

  // Parse connection string into individual fields
  useEffect(() => {
    if (connString && !editId) {
      try {
        const parsed = parseConnectionURL(connString);
        setForm(f => ({
          ...f,
          host: parsed.host || f.host,
          port: String(parsed.port || POSTGRESQL_PROVIDER.defaultPort),
          database: parsed.database || f.database,
          user: parsed.user || f.user,
          password: parsed.password || f.password,
          sslmode: parsed.sslmode || (parsed.ssl ? "require" : f.sslmode),
        }));
      } catch {
        // keep existing values
      }
    }
  }, [connString, editId]);

  // Sync connection string back to fields when user types a URL
  const handleConnStringChange = (val: string) => {
    setForm(f => ({ ...f, connectionString: val }));
    if (val) {
      try {
        const parsed = parseConnectionURL(val);
        setForm(f => ({
          ...f,
          host: parsed.host || f.host,
          port: String(parsed.port || f.port),
          database: parsed.database || f.database,
          user: parsed.user || f.user,
          password: parsed.password || f.password,
          sslmode: parsed.sslmode || (parsed.ssl ? "require" : f.sslmode),
        }));
      } catch {}
    }
  };

  // Load an existing connection from the Rust store (single source of truth)
  useEffect(() => {
    if (editingConn) {
      let parsed: ReturnType<typeof parseConnectionURL> | undefined;
      try { parsed = parseConnectionURL(editingConn.url); } catch { /* fall back to fields */ }
      setForm(f => ({
        ...f,
        name: editingConn.name || f.name,
        host: parsed?.host || "",
        port: String(parsed?.port || POSTGRESQL_PROVIDER.defaultPort),
        database: parsed?.database || "",
        user: parsed?.user || "",
        password: parsed?.password || "",
        connectionString: editingConn.url || "",
        sslmode: parsed?.sslmode || (parsed?.ssl ? "require" : f.sslmode),
        readOnly: !!editingConn.readOnly,
      }));
    }
  }, [editingConn?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name is required"); return; }

    const url = form.connectionString
      ? withSslMode(form.connectionString, form.sslmode)
      : buildConnectionURL({
          host: form.host || "localhost",
          port: form.port ? parseInt(form.port, 10) : POSTGRESQL_PROVIDER.defaultPort,
          database: form.database || "",
          user: form.user || "",
          password: form.password || "",
          sslmode: form.sslmode,
        });

    try {
      if (editId) {
        await updateConnectionMutation.mutateAsync({ id: editId, name: form.name, url });
        toast.success("Connection updated");
      } else {
        await addConnectionMutation.mutateAsync({ name: form.name, url });
        toast.success("Connection added");
      }
      navigate("/");
    } catch (err) {
      toast.error("Failed to save connection", { description: String(err) });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center px-6 shrink-0 bg-muted/20">
        <button onClick={() => navigate("/add-connection")} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto p-6 pt-8">
          <div className="space-y-2 mb-8">
            <h1 className="text-2xl font-semibold">
              {isEditing ? "Edit" : "New"} PostgreSQL Connection
            </h1>
            <p className="text-muted-foreground">{POSTGRESQL_PROVIDER.description}</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Connection Name *</Label>
              <Input id="name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Database" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="connectionString">Connection String (optional)</Label>
              <Input id="connectionString" value={form.connectionString}
                onChange={e => handleConnStringChange(e.target.value)}
                placeholder={POSTGRESQL_PROVIDER.urlPlaceholder} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="host">Host</Label>
                <Input id="host" value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="localhost" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input id="port" value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))} placeholder={String(POSTGRESQL_PROVIDER.defaultPort)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="database">Database</Label>
                <Input id="database" value={form.database} onChange={e => setForm(f => ({ ...f, database: e.target.value }))} placeholder="mydb" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user">User</Label>
                <Input id="user" value={form.user} onChange={e => setForm(f => ({ ...f, user: e.target.value }))} placeholder="postgres" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="password" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sslmode">SSL Mode</Label>
                <Select value={form.sslmode} onValueChange={v => setForm(f => ({ ...f, sslmode: v }))}>
                  <SelectTrigger id="sslmode"><SelectValue placeholder="Prefer" /></SelectTrigger>
                  <SelectContent>
                    {SSL_MODES.map(mode => (
                      <SelectItem key={mode} value={mode}>{mode === "verify-full" ? "Verify Full" : mode[0].toUpperCase() + mode.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch checked={form.readOnly} onCheckedChange={v => setForm(f => ({ ...f, readOnly: v }))} id="readOnly" />
                <Label htmlFor="readOnly">Read-only</Label>
              </div>
            </div>
            <div className="flex gap-3">
              <Button type="submit" disabled={addConnectionMutation.isPending || updateConnectionMutation.isPending}>
                {isEditing ? "Update" : "Save"} Connection
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate("/")}>Cancel</Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
