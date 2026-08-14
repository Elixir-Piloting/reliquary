"use client";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { AppLogo } from "@/components/app-logo";
import { ArrowLeft, Server } from "lucide-react";

export default function AddConnectionPage() {
  const navigate = useNavigate();
  const [connectionString, setConnectionString] = useState("");

  const handleConnectionStringContinue = () => {
    if (!connectionString.trim()) return;
    const url = connectionString.trim();
    navigate(`/add-connection/postgresql?connectionString=${encodeURIComponent(url)}`);
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 shrink-0 border-b border-border">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />Back
        </Button>
        <div className="flex items-center gap-2">
          <AppLogo className="h-5 w-5" />
          <span className="text-sm font-medium">Add Connection</span>
        </div>
      </div>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto p-6 space-y-8 pt-8">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Add Connection</h1>
            <p className="text-muted-foreground">Connect to your PostgreSQL database by entering a connection string.</p>
          </div>
          <div className="space-y-3">
            <Label htmlFor="connectionString">Connection String</Label>
            <div className="flex gap-2">
              <Input id="connectionString" value={connectionString}
                onChange={e => setConnectionString(e.target.value)}
                placeholder="postgresql://user:password@host:port/database"
                onKeyDown={e => e.key === "Enter" && handleConnectionStringContinue()}
              />
              <Button onClick={handleConnectionStringContinue} disabled={!connectionString.trim()}>Continue</Button>
            </div>
          </div>
          <div className="relative flex items-center gap-4">
            <Separator className="flex-1" />
            <span className="text-sm text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>
          <Button variant="outline" className="w-full justify-start gap-3" onClick={() => navigate("/add-connection/local")}>
            <Server className="h-4 w-4" />Continue with local PostgreSQL
          </Button>
        </div>
      </main>
    </div>
  );
}