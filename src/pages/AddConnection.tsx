"use client";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DatabaseProvider } from "@/lib/db/providers";
import { ProviderGrid } from "@/components/provider-grid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Server } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AddConnectionPage() {
  const navigate = useNavigate();
  const [connectionString, setConnectionString] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const handleProviderSelect = (provider: DatabaseProvider) => {
    navigate(`/add-connection/${provider}`);
  };

  const handleConnectionStringContinue = () => {
    if (!connectionString.trim()) return;
    const url = connectionString.trim();
    let provider = "postgresql";
    if (url.startsWith("mysql://") || url.startsWith("mariadb://")) provider = "mysql";
    else if (url.startsWith("sqlite://") || url.endsWith(".db")) provider = "sqlite";
    else if (url.startsWith("mongodb://") || url.startsWith("mongodb+srv://")) provider = "mongodb";
    else if (url.startsWith("redis://")) provider = "redis";
    else if (url.startsWith("libsql://")) provider = "libsql";
    navigate(`/add-connection/${provider}?connectionString=${encodeURIComponent(url)}`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center px-6 shrink-0 bg-muted/20">
        <button onClick={() => navigate("/")} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto p-6 space-y-8 pt-8">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Add Connection</h1>
            <p className="text-muted-foreground">Connect to your database by entering a connection string or selecting a provider.</p>
          </div>
          <div className="space-y-3">
            <Label htmlFor="connectionString">Connection String</Label>
            <div className="flex gap-2">
              <Input id="connectionString" value={connectionString}
                onChange={e => { setConnectionString(e.target.value); setParseError(null); }}
                placeholder="postgresql://user:password@host:port/database"
                className={cn(parseError && "border-destructive")}
                onKeyDown={e => e.key === "Enter" && handleConnectionStringContinue()}
              />
              <Button onClick={handleConnectionStringContinue} disabled={!connectionString.trim()}>Continue</Button>
            </div>
            {parseError && <p className="text-sm text-destructive">{parseError}</p>}
          </div>
          <div className="relative flex items-center gap-4">
            <Separator className="flex-1" />
            <span className="text-sm text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>
          <div className="space-y-4">
            <h2 className="text-lg font-medium">Select a Provider</h2>
            <ProviderGrid onSelect={handleProviderSelect} />
          </div>
          <div className="relative flex items-center gap-4">
            <Separator className="flex-1" />
            <span className="text-sm text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>
          <Button variant="outline" className="w-full justify-start gap-3" onClick={() => navigate("/add-connection/postgresql?local=true")}>
            <Server className="h-4 w-4" />Continue with local PostgreSQL
          </Button>
        </div>
      </main>
    </div>
  );
}
