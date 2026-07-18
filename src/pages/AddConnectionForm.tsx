"use client";
import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { getProviderMetadata, DatabaseProvider } from "@/lib/db/providers";
import { addConnection, updateConnection, getConnection } from "@/lib/connections/store";
import { parseConnectionURL } from "@/lib/connections/url-parser";
import type { ConnectionConfig } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export default function AddConnectionFormPage() {
  const { provider } = useParams<{ provider: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const meta = getProviderMetadata(provider as DatabaseProvider);
  const editId = searchParams.get("connectionId");
  const connString = searchParams.get("connectionString");

  const isLocalPg = provider === "postgresql" && searchParams.get("local") === "true";

  const [form, setForm] = useState({
    name: "",
    host: isLocalPg ? "localhost" : "",
    port: String(isLocalPg ? 5432 : meta?.defaultPort || 5432),
    database: isLocalPg ? "postgres" : "",
    user: isLocalPg ? "postgres" : "",
    password: "",
    filePath: "",
    connectionString: connString || "",
    ssl: false,
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
          port: String(parsed.port || meta?.defaultPort || 5432),
          database: parsed.database || f.database,
          user: parsed.user || f.user,
          password: parsed.password || f.password,
          ssl: parsed.ssl || false,
        }));
      } catch {
        // keep existing values
      }
    }
  }, [connString, editId, meta?.defaultPort]);

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
          ssl: parsed.ssl || f.ssl,
        }));
      } catch {}
    }
  };

  useEffect(() => {
    if (editId) {
      const conn = getConnection(editId);
      if (conn) {
        setForm({
          name: conn.name || "",
          host: conn.host || "",
          port: String(conn.port || meta?.defaultPort || 5432),
          database: conn.database || "",
          user: conn.user || "",
          password: conn.password || "",
          filePath: conn.filePath || "",
          connectionString: conn.connectionString || "",
          ssl: conn.ssl || false,
        });
      }
    }
  }, [editId]);

  if (!meta) return <div className="p-8 text-center text-muted-foreground">Unknown provider</div>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name is required"); return; }

    const config: ConnectionConfig = {
      id: editId || crypto.randomUUID(),
      name: form.name,
      provider: provider!,
      host: form.host || undefined,
      port: form.port ? parseInt(form.port) : undefined,
      database: form.database || undefined,
      user: form.user || undefined,
      password: form.password || undefined,
      filePath: form.filePath || undefined,
      connectionString: form.connectionString || undefined,
      ssl: form.ssl || undefined,
    };

    if (isLocalPg) {
      config.host = "localhost";
      config.port = 5432;
      config.database = "postgres";
      config.user = "postgres";
    }

    if (editId) {
      updateConnection(editId, config);
      toast.success("Connection updated");
    } else {
      addConnection(config);
      toast.success("Connection added");
    }
    navigate("/");
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
              {isLocalPg ? "Local PostgreSQL" : isEditing ? "Edit" : "New"} {meta.name} Connection
            </h1>
            <p className="text-muted-foreground">{isLocalPg ? "Connect to a local PostgreSQL server" : meta.description}</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Connection Name *</Label>
              <Input id="name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Database" />
            </div>
            {meta.connectionType === "file" ? (
              <div className="space-y-2">
                <Label htmlFor="filePath">Database File</Label>
                <Input id="filePath" value={form.filePath} onChange={e => setForm(f => ({ ...f, filePath: e.target.value }))} placeholder="/path/to/database.db" />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="connectionString">Connection String (optional)</Label>
                  <Input id="connectionString" value={form.connectionString}
                    onChange={e => handleConnStringChange(e.target.value)}
                    placeholder={meta.urlPlaceholder || "postgresql://user:password@host:port/database"} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="host">Host</Label>
                    <Input id="host" value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="localhost" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="port">Port</Label>
                    <Input id="port" value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))} placeholder={String(meta.defaultPort || 5432)} />
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
              </>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={form.ssl} onCheckedChange={v => setForm(f => ({ ...f, ssl: v }))} id="ssl" />
              <Label htmlFor="ssl">Use SSL</Label>
            </div>
            <div className="flex gap-3">
              <Button type="submit">{isEditing ? "Update" : "Save"} Connection</Button>
              <Button type="button" variant="outline" onClick={() => navigate("/")}>Cancel</Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
