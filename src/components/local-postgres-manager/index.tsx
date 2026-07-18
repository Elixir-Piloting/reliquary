import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Server } from "lucide-react";
import { toast } from "sonner";
import { Persistence } from "@/lib/persistence";
import { useLocalServers, useLocalPgDatabases } from "@/lib/query/hooks/use-local-pg-servers";
import type { LocalPgDatabase } from "@/lib/ipc-client";
import type { ConnectionConfig } from "@/lib/db/types";
import { DatabaseProvider } from "@/lib/db/providers";
import type { LocalPostgresServer, LocalPostgresManagerProps } from "./types";
import { ServerList } from "./ServerList";

export function LocalPostgresManager({ onServerSelect }: LocalPostgresManagerProps) {
  const { data: servers = [], isLoading: isDetecting, refetch: detectServers } = useLocalServers();
  const loadDatabases = useLocalPgDatabases();

  const [databases, setDatabases] = useState<Record<string, LocalPgDatabase[]>>({});
  const [loadingDb, setLoadingDb] = useState<string | null>(null);

  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordForServer, setPasswordForServer] = useState<LocalPostgresServer | null>(null);
  const [tempUser, setTempUser] = useState("postgres");
  const [tempPassword, setTempPassword] = useState("");
  const [savePassword, setSavePassword] = useState(false);
  const [pendingDatabase, setPendingDatabase] = useState<string | null>(null);

  const [showNameDialog, setShowNameDialog] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<{ server: LocalPostgresServer; database: string; user?: string; password?: string } | null>(null);
  const [connectionName, setConnectionName] = useState("");

  const handleExpand = async (server: LocalPostgresServer) => {
    const key = `${server.host}:${server.port}`;
    if (databases[key]) {
      server.expanded = !server.expanded;
      return;
    }

    server.expanded = true;
    const saved = Persistence.getServerPassword(server.host, server.port);
    if (saved) {
      setLoadingDb(key);
      try {
        const dbs = await loadDatabases.mutateAsync({ host: server.host, port: server.port, user: saved.user, password: saved.password });
        setDatabases(prev => ({ ...prev, [key]: dbs }));
      } catch {
        const dbs = await loadDatabases.mutateAsync({ host: server.host, port: server.port });
        setDatabases(prev => ({ ...prev, [key]: dbs }));
      }
      setLoadingDb(null);
    } else {
      try {
        setLoadingDb(key);
        const dbs = await loadDatabases.mutateAsync({ host: server.host, port: server.port });
        setDatabases(prev => ({ ...prev, [key]: dbs }));
      } catch {
        setLoadingDb(null);
        setTempUser("postgres");
        setTempPassword("");
        setPasswordForServer(server);
        setSavePassword(false);
        setShowPasswordDialog(true);
        return;
      }
      setLoadingDb(null);
    }
  };

  const handlePasswordSubmit = async () => {
    if (!passwordForServer) return;
    const key = `${passwordForServer.host}:${passwordForServer.port}`;

    if (savePassword) {
      Persistence.setServerPassword(passwordForServer.host, passwordForServer.port, tempUser, tempPassword);
    }

    if (pendingDatabase) {
      handleConnectToDatabase(passwordForServer, pendingDatabase, tempUser, tempPassword);
      setShowPasswordDialog(false);
      setPasswordForServer(null);
      setPendingDatabase(null);
      return;
    }

    setLoadingDb(key);
    try {
      const dbs = await loadDatabases.mutateAsync({ host: passwordForServer.host, port: passwordForServer.port, user: tempUser, password: tempPassword });
      setDatabases(prev => ({ ...prev, [key]: dbs }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to connect");
    }
    setLoadingDb(null);
    setShowPasswordDialog(false);
    setPasswordForServer(null);
  };

  const handleConnectToDatabase = (
    server: LocalPostgresServer,
    database: string,
    user?: string,
    password?: string,
  ) => {
    const saved = Persistence.getServerPassword(server.host, server.port);
    const finalUser = user || saved?.user || "postgres";
    const finalPassword = password || saved?.password || "";

    if (!user && !password && !saved) {
      setPendingDatabase(database);
      setTempUser("postgres");
      setTempPassword("");
      setPasswordForServer(server);
      setShowPasswordDialog(true);
      return;
    }

    setPendingConnection({ server, database, user: finalUser, password: finalPassword });
    setConnectionName(database);
    setShowNameDialog(true);
  };

  const handleSaveName = () => {
    if (!pendingConnection) return;
    const { server, database, user, password } = pendingConnection;
    const config: ConnectionConfig = {
      id: `conn-${Date.now()}`,
      name: connectionName.trim() || database,
      provider: DatabaseProvider.POSTGRESQL,
      host: server.host,
      port: server.port,
      database,
      user,
      password,
    };
    onServerSelect(config);
    setShowNameDialog(false);
    setPendingConnection(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Local PostgreSQL Servers</h3>
          <p className="text-xs text-muted-foreground">Automatically detect and connect to local PostgreSQL instances</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => detectServers()} disabled={isDetecting}>
          {isDetecting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Detecting...</> : <><Server className="mr-2 h-4 w-4" />Refresh</>}
        </Button>
      </div>

      <ServerList servers={servers} databases={databases} loadingDb={loadingDb} isDetecting={isDetecting}
        onServerExpand={handleExpand}
        onDatabaseConnect={(server, db) => handleConnectToDatabase(server, db.name)} />

      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enter Password</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label>Username</Label>
              <Input value={tempUser} onChange={e => setTempUser(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Password</Label>
              <Input type="password" value={tempPassword} onChange={e => setTempPassword(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="save" checked={savePassword} onCheckedChange={c => setSavePassword(!!c)} />
              <label htmlFor="save" className="text-sm">Save password</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>Cancel</Button>
            <Button onClick={handlePasswordSubmit}>Connect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNameDialog} onOpenChange={setShowNameDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Name your connection</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label>Connection Name</Label>
              <Input value={connectionName} onChange={e => setConnectionName(e.target.value)} placeholder="My Database" autoFocus />
            </div>
            {pendingConnection && <p className="text-sm text-muted-foreground">Connecting to: {pendingConnection.database}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowNameDialog(false); setPendingConnection(null); }}>Cancel</Button>
            <Button onClick={handleSaveName}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
