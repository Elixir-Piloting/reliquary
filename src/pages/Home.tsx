"use client";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getProviderMetadata } from "@/lib/db/providers";
import { useConnections, useDeleteConnection, useConnect } from "@/lib/query/hooks/use-connections";
import type { Connection } from "@/lib/ipc-client";
import { getSubtleBackground } from "@/lib/utils/color";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppLogo } from "@/components/app-logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Database, Plus, Search, Loader2, Pencil, Copy, Trash2, EllipsisVertical, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

function ProviderIcon({ provider, className }: { provider: string; className?: string }) {
  const meta = getProviderMetadata(provider);
  if (!meta) return <div className={cn("w-5 h-5 rounded-sm bg-muted", className)} />;
  return (
    <div className={cn("relative w-5 h-5 shrink-0 rounded-sm flex items-center justify-center", className)}
      style={{ backgroundColor: getSubtleBackground(meta.color, 1.0) }}>
      {meta.iconType === "image" ? (
        <img src={meta.icon} alt={meta.name} className="w-full h-full object-contain p-0.5"
          onError={e => { const p = e.currentTarget.parentElement; if (p) p.innerHTML = `<span class="text-[8px] font-bold" style="color: ${meta.color === '#FFFFFF' || meta.color === '#000000' ? '#1d1d1f' : '#fff'}">${meta.name.charAt(0)}</span>`; }} />
      ) : (
        <span className="text-xs font-bold" style={{ color: meta.color === "#FFFFFF" || meta.color === "#000000" ? "#1d1d1f" : "#fff" }}>{meta.name.charAt(0)}</span>
      )}
    </div>
  );
}

const PROVIDER_BADGES: Record<string, { label: string; dot: string; text: string; ring: string }> = {
  neon: {
    label: "Neon",
    dot: "bg-[#7C3AED]",
    text: "text-[#7C3AED]",
    ring: "border-[#7C3AED]/30 bg-[#7C3AED]/10",
  },
  supabase: {
    label: "Supabase",
    dot: "bg-[#3ECF8E]",
    text: "text-[#3ECF8E]",
    ring: "border-[#3ECF8E]/30 bg-[#3ECF8E]/10",
  },
  postgresql: {
    label: "PostgreSQL",
    dot: "bg-[#336791]",
    text: "text-[#336791]",
    ring: "border-[#336791]/30 bg-[#336791]/10",
  },
};

function ProviderBadge({ provider }: { provider?: string }) {
  const style = PROVIDER_BADGES[provider || "postgresql"] ?? PROVIDER_BADGES.postgresql;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", style.ring, style.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {style.label}
    </span>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [connectionToDelete, setConnectionToDelete] = useState<Connection | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const { data: connections = [], isLoading } = useConnections();
  const deleteConnectionMutation = useDeleteConnection();
  const connectMutation = useConnect();

  const filteredConnections = connections.filter(conn =>
    conn.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conn.url.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleConnectionSelect = async (conn: Connection) => {
    setConnectingId(conn.id);
    try {
      await connectMutation.mutateAsync({ connectionId: conn.id, url: conn.url, readOnly: !!conn.readOnly });
      console.log("connected, navigating");
      navigate(`/db/${conn.id}`);
    } catch (e: any) {
      console.error("connection error", e);
      toast.error("Connection failed", { description: String(e) });
    } finally {
      setConnectingId(null);
    }
  };

  const handleCopyUrl = (conn: Connection) => {
    navigator.clipboard.writeText(conn.url);
    toast.success("Connection URL copied to clipboard");
    setOpenPopoverId(null);
  };

  const handleDeleteClick = (conn: Connection) => {
    setConnectionToDelete(conn);
    setDeleteDialogOpen(true);
    setOpenPopoverId(null);
  };

  const handleConfirmDelete = async () => {
    if (!connectionToDelete) return;
    try {
      await deleteConnectionMutation.mutateAsync(connectionToDelete.id);
      toast.success("Connection deleted");
    } catch (e) {
      toast.error("Failed to delete connection", { description: String(e) });
    }
    setDeleteDialogOpen(false);
    setConnectionToDelete(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0 bg-muted/20">
        <div className="flex items-center gap-2">
          <AppLogo className="h-5 w-5" />
          <span className="font-medium">Relic</span>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto marketing-buttons marketing-inputs">
        <div className="max-w-xl mx-auto p-6">
          <div className="space-y-8 pt-8">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold">Connections</h1>
              <p className="text-muted-foreground">Manage your database connections</p>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search connections..." className="pl-9" />
              </div>
              <Button onClick={() => navigate("/add-connection")} className="gap-2 shrink-0"><Plus className="h-4 w-4" />Add Connection</Button>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : filteredConnections.length === 0 ? (
              <div className="text-center py-12">
                <Database className="h-12 w-12 mx-auto opacity-50 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">{searchQuery ? "No connections found" : "No connections yet"}</h3>
                <p className="text-muted-foreground mb-6">{searchQuery ? "Try a different search term" : "Create your first database connection to get started."}</p>
                {!searchQuery && <Button onClick={() => navigate("/add-connection")}><Plus className="h-4 w-4 mr-2" />Add Connection</Button>}
              </div>
            ) : (
              <div className="grid gap-3 no-ring">
                {filteredConnections.map(conn => (
                  <div key={conn.id} className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 hover:border-accent-foreground/20 transition-colors">
                    <button onClick={() => handleConnectionSelect(conn)} className="flex items-center gap-4 min-w-0 flex-1 text-left">
                      <ProviderIcon provider={conn.provider || "postgresql"} />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{conn.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <ProviderBadge provider={conn.provider} />
                          {conn.readOnly && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <ShieldCheck className="h-3 w-3" />Read-only
                            </span>
                          )}
                        </div>
                      </div>
                      {connectingId === conn.id && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
                    </button>
                    <Popover open={openPopoverId === conn.id} onOpenChange={(open) => setOpenPopoverId(open ? conn.id : null)}>
                      <PopoverTrigger asChild>
                        <button className="p-2 rounded-full hover:bg-accent transition-colors"><EllipsisVertical className="h-4 w-4 text-muted-foreground" /></button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-2" align="end">
                        <div className="space-y-1">
                          <button onClick={() => handleCopyUrl(conn)} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-left rounded-md hover:bg-accent"><Copy className="h-4 w-4" />Copy URL</button>
                          <button onClick={() => navigate(`/add-connection/${conn.provider || "postgresql"}?connectionId=${conn.id}`)} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-left rounded-md hover:bg-accent"><Pencil className="h-4 w-4" />Edit</button>
                          <Separator className="my-1" />
                          <button onClick={() => handleDeleteClick(conn)} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-left rounded-md hover:bg-accent text-destructive"><Trash2 className="h-4 w-4" />Delete</button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Connection</DialogTitle><DialogDescription>Are you sure you want to delete "{connectionToDelete?.name}"? This action cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleteConnectionMutation.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
