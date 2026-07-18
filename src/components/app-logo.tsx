"use client";
import { cn } from "@/lib/utils";

export function AppLogo({ className }: { className?: string }) {
  return (
    <div className={cn("relative w-5 h-5 rounded-lg flex items-center justify-center font-bold text-xs text-white", className)}
      style={{ background: "linear-gradient(135deg, rgba(30,133,186,0.8), rgba(78,90,106,0.9))" }}
    >
      R
    </div>
  );
}
