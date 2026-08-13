"use client";
import { useNavigate } from "react-router-dom";
import { LocalPostgresManager } from "@/components/local-postgres-manager";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useAddConnection, useConnect } from "@/lib/query/hooks/use-connections";
import type { LocalPostgresConnectionDraft } from "@/components/local-postgres-manager/types";
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
      toast.error("Connection failed", { description: String(e) });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center px-6 shrink-0 bg-muted/20">
        <Button variant="ghost" size="sm" onClick={() => navigate("/add-connection")}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto p-6 pt-8 space-y-6">
          <LocalPostgresManager onServerSelect={handleServerSelect} />
        </div>
      </main>
    </div>
  );
}
