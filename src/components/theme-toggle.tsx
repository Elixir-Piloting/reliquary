"use client";
import { useState, useEffect } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

const themes = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

function getStoredTheme(): string {
  if (typeof window === "undefined") return "system";
  return localStorage.getItem("relic_theme") || "system";
}

function applyTheme(value: string) {
  const root = document.documentElement;
  if (value === "dark") {
    root.classList.add("dark");
  } else if (value === "light") {
    root.classList.remove("dark");
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  }
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setThemeState] = useState(getStoredTheme);

  useEffect(() => {
    const handler = () => setThemeState(getStoredTheme());
    window.addEventListener("theme-change", handler);
    return () => window.removeEventListener("theme-change", handler);
  }, []);

  const setTheme = (value: string) => {
    localStorage.setItem("relic_theme", value);
    applyTheme(value);
    setThemeState(value);
    window.dispatchEvent(new Event("theme-change"));
  };

  return (
    <div className={cn("flex gap-1 p-1 bg-muted rounded-lg", className)}>
      {themes.map(({ value, label, icon: Icon }) => (
        <button key={value} onClick={() => setTheme(value)}
          className={cn("flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors",
            theme === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10"
          )} title={label}>
          <Icon className="h-4 w-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
