"use client";
import { useNavigate } from "react-router-dom";
import { LocalPostgresManager } from "@/components/local-postgres-manager";
import { Button } from "@/components/ui/button";
import { AppLogo } from "@/components/app-logo";
import { ArrowLeft } from "lucide-react";
import { useAddConnection, useConnect } from "@/lib/query/hooks/use-connections";
import type { LocalPostgresConnectionDraft } from "@/components/local-postgres-manager/types";
import { Persistence } from "@/lib/persistence";
import { toast } from "sonner";

export default function LocalPostgresSelectionPage() {
  const navigate = useNavigate();
  const addConnectionMutation = useAddConnection();
  const connectMutation = useConnect();

  const handleServerSelect = async (config: LocalPostgresConnectionDraft) => {
    try {
      const created = await addConnectionMutation.mutateAsync({ name: config.name, url: config.url });
      await connectMutation.mutateAsync({ connectionId: created.id, url: created.url, readOnly: false });
      toast.success(`Connected to ${config.name}`);
      navigate(`/db/${created.id}`);
    } catch (e: any) {
      // A failed connect may be due to bad saved credentials — drop them so the
      // next attempt re-prompts for the password.
      const m = String(e).toLowerCase();
      if (m.includes("password") || m.includes("auth") || m.includes("28p01") || m.includes("28p")) {
        try {
          const u = new URL(config.url);
          Persistence.removeServerPassword(u.hostname, Number(u.port || 5432));
        } catch { /* ignore */ }
      }
      console.error("[local-pg] connect ERROR:", e);
      toast.error(String(e));
    }
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 shrink-0 border-b border-border">
        <Button variant="ghost" size="sm" onClick={() => navigate("/add-connection")} className="gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />Back
        </Button>
        <div className="flex items-center gap-2">
          <AppLogo className="h-5 w-5" />
          <span className="text-sm font-medium">Local PostgreSQL</span>
        </div>
      </div>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto p-6 pt-8 space-y-6">
          <LocalPostgresManager onServerSelect={handleServerSelect} />
        </div>
      </main>
    </div>
  );
}
