"use client";
import { useNavigate } from "react-router-dom";
import { LocalPostgresManager } from "@/components/local-postgres-manager";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { addConnection } from "@/lib/connections/store";
import { buildConnectionURL } from "@/lib/connections/url-parser";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectionConfig } from "@/lib/db/types";
import { toast } from "sonner";

export default function LocalPostgresSelectionPage() {
  const navigate = useNavigate();

  const handleServerSelect = async (config: ConnectionConfig) => {
    try {
      addConnection(config);
      const url = buildConnectionURL({
        host: config.host || "localhost",
        port: config.port || 5432,
        database: config.database || "",
        user: config.user || "",
        password: config.password || "",
      });
      await invoke("connect", { connectionId: config.id, url });
      toast.success(`Connected to ${config.database}`);
      navigate(`/db/${config.id}`);
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
