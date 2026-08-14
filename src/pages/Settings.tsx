"use client";
import { useNavigate } from "react-router-dom";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppLogo } from "@/components/app-logo";
import { ArrowLeft, Palette, Database } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  const navigate = useNavigate();

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 shrink-0 border-b border-border">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />Back
        </Button>
        <div className="flex items-center gap-2">
          <AppLogo className="h-5 w-5" />
          <span className="text-sm font-medium">Settings</span>
        </div>
      </div>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6">
          <div className="space-y-8">
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Palette className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-medium">Appearance</h2>
              </div>
              <div className="bg-card rounded-lg border border-border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Theme</p>
                    <p className="text-sm text-muted-foreground">Choose your preferred color scheme</p>
                  </div>
                  <ThemeToggle />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-medium">Database</h2>
              </div>
              <div className="bg-card rounded-lg border border-border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Connections</p>
                    <p className="text-sm text-muted-foreground">Manage your saved database connections</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate("/")}>Manage</Button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
