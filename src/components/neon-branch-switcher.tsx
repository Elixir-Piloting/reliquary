"use client";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GitBranch, Loader2, Check, KeyRound, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import API from "@/lib/ipc-client";
import type { Connection, NeonBranch } from "@/lib/ipc-client";
import { queryKeys } from "@/lib/query/keys";
import { dispatchBranchSwitched } from "@/lib/branch-events";
import { cn } from "@/lib/utils";

interface NeonBranchSwitcherProps {
  connectionId: string;
  readOnly: boolean;
}

function hostsMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

export function NeonBranchSwitcher({ connectionId, readOnly }: NeonBranchSwitcherProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [keyLoading, setKeyLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [branches, setBranches] = useState<NeonBranch[] | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [switchingBranchId, setSwitchingBranchId] = useState<string | null>(null);
  const [connectionUrl, setConnectionUrl] = useState<string>("");

  const loadKeyAndUrl = useCallback(async (isCancelled?: () => boolean) => {
    const alive = () => !isCancelled?.();
    setKeyLoading(true);
    try {
      const list = await API.listConnections();
      const conn = list.find((c: Connection) => c.id === connectionId);
      if (alive()) setApiKey(conn?.neonApiKey ?? null);
      if (alive()) setConnectionUrl(conn?.url ?? "");
    } catch {
      if (alive()) setApiKey(null);
    }
    if (alive()) setKeyLoading(false);
  }, [connectionId]);

  const loadBranches = useCallback(async (key: string, isCancelled?: () => boolean) => {
    const alive = () => !isCancelled?.();
    setBranchesLoading(true);
    setBranchesError(null);
    try {
      const result = await API.listNeonBranches(connectionId, key);
      if (alive()) setBranches(result);
    } catch (e) {
      if (alive()) { setBranchesError(String(e)); setBranches(null); }
    }
    if (alive()) setBranchesLoading(false);
  }, [connectionId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBranches(null);
    setBranchesError(null);
    loadKeyAndUrl(() => cancelled);
    return () => { cancelled = true; };
  }, [open, loadKeyAndUrl]);

  useEffect(() => {
    if (!open || !apiKey) return;
    let cancelled = false;
    loadBranches(apiKey, () => cancelled);
    return () => { cancelled = true; };
  }, [open, apiKey, loadBranches]);

  const handleSaveKey = async () => {
    const key = apiKeyDraft.trim();
    if (!key) { toast.error("Neon API key is required"); return; }
    setSavingKey(true);
    try {
      await API.saveNeonApiKey(connectionId, key);
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all });
      setApiKey(key);
      setApiKeyDraft("");
      toast.success("Neon API key saved");
    } catch (e) {
      toast.error("Failed to save Neon API key", { description: String(e) });
    }
    setSavingKey(false);
  };

  const currentBranch = branches?.find(b => b.connectionUri && hostsMatch(b.connectionUri, connectionUrl))
    ?? branches?.find(b => b.primary)
    ?? null;

  const handleSelectBranch = async (branch: NeonBranch) => {
    if (branch.id === currentBranch?.id) { setOpen(false); return; }
    if (!branch.connectionUri) {
      toast.error(`Branch "${branch.name}" has no connection URI available`, {
        description: "This branch has no active compute endpoint, so it can't be connected to from here.",
      });
      return;
    }
    setSwitchingBranchId(branch.id);
    try {
      await API.disconnect(connectionId);
      await API.updateConnection(connectionId, { url: branch.connectionUri });
      await API.connect(connectionId, branch.connectionUri, readOnly);
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.db.schema(connectionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.db.status(connectionId) });
      setConnectionUrl(branch.connectionUri);
      setBranches(null);
      dispatchBranchSwitched();
      toast.success(`Switched to branch "${branch.name}"`);
      setOpen(false);
    } catch (e) {
      toast.error(`Failed to switch to branch "${branch.name}"`, { description: String(e) });
    }
    setSwitchingBranchId(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 px-3 gap-2 text-sm font-medium">
          <GitBranch className="h-4 w-4" />
          <span className="max-w-[140px] truncate">{currentBranch?.name ?? "Branches"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px]" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Neon branches</span>
            </div>
            {apiKey && (
              <Button variant="ghost" size="icon" className="h-6 w-6" title="Change API key" onClick={() => { setApiKey(null); setBranches(null); }}>
                <KeyRound className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {keyLoading ? (
            <div className="py-6 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !apiKey ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Enter your Neon API key to list and switch branches. It is stored locally on this device.
              </p>
              <Input
                type="password"
                placeholder="Neon API key"
                value={apiKeyDraft}
                onChange={e => setApiKeyDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSaveKey(); }}
              />
              <Button className="w-full" size="sm" onClick={handleSaveKey} disabled={savingKey}>
                {savingKey ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
                Save key &amp; load branches
              </Button>
            </div>
          ) : branchesLoading ? (
            <div className="py-6 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : branchesError ? (
            <div className="space-y-2">
              <p className="text-xs text-destructive break-words">{branchesError}</p>
              <Button variant="outline" size="sm" className="w-full" onClick={() => loadBranches(apiKey)}>
                <RefreshCw className="h-3.5 w-3.5 mr-2" />Retry
              </Button>
            </div>
          ) : branches && branches.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No branches found</p>
          ) : branches ? (
            <ScrollArea className="max-h-[300px] -mx-1 px-1">
              <div className="space-y-1">
                {branches.map(branch => {
                  const isCurrent = branch.id === currentBranch?.id;
                  const noUri = !branch.connectionUri;
                  return (
                    <button
                      key={branch.id}
                      onClick={() => handleSelectBranch(branch)}
                      disabled={switchingBranchId !== null || noUri}
                      title={noUri ? "No connection URI available for this branch" : undefined}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm hover:bg-accent transition-colors",
                        noUri && "opacity-50 cursor-not-allowed",
                        isCurrent && "bg-accent"
                      )}
                    >
                      <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{branch.name}</span>
                          {branch.primary && <Badge variant="outline" className="px-1 py-0 h-4 text-[9px] text-violet-500 border-violet-500/30 bg-violet-500/10 shrink-0">PRIMARY</Badge>}
                          {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {new Date(branch.createdAt).toLocaleDateString()}
                          {noUri && <span className="ml-1">· no endpoint</span>}
                        </div>
                      </div>
                      {switchingBranchId === branch.id && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          ) : null}

          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <ExternalLink className="h-3 w-3" />
            Branch URIs come from Neon's API; branches without an active compute endpoint can't be connected to.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
