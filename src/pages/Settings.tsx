"use client";
import { useNavigate } from "react-router-dom";
import { ThemeToggle } from "@/components/theme-toggle";
import { Settings, Palette, ArrowLeft, AppWindow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/breadcrumbs";

export default function SettingsPage() {
  const navigate = useNavigate();

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0 bg-muted/20">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
            <ArrowLeft className="h-4 w-4" />Back
          </Button>
          <Breadcrumbs items={[{ label: "Settings" }]} />
        </div>
        <div className="flex items-center gap-2">
          <AppWindow className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">Relic</span>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Settings className="h-6 w-6" />Settings
            </h1>
            <p className="text-muted-foreground mt-1">Customize your Relic experience</p>
          </div>
          <div className="space-y-8">
            <section className="space-y-4">
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
            <section className="space-y-4">
              <h2 className="text-lg font-medium">About</h2>
              <div className="bg-card rounded-lg border border-border p-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Version</span>
                    <span>1.0.0</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Built with</span>
                    <span>Tauri, React, Tailwind CSS</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
