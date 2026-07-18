"use client";
import { cn } from "@/lib/utils";

export function AppLogo({ className }: { className?: string }) {
  return (
    <div className={cn("relative rounded-lg overflow-hidden aspect-square border-2 border-[#1e85ba]/20 shadow-sm", className)} style={{
      background: `
        linear-gradient(135deg, 
          rgba(223, 255, 254, 0.15) 0%, 
          rgba(30, 133, 186, 0.2) 30%, 
          rgba(78, 90, 106, 0.25) 60%, 
          rgba(12, 16, 24, 0.3) 100%
        ),
        repeating-linear-gradient(
          45deg,
          transparent,
          transparent 2px,
          rgba(30, 133, 186, 0.03) 2px,
          rgba(30, 133, 186, 0.03) 4px
        )
      `,
    }}>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative w-full h-full p-2">
          <img src="/applogo.png" alt="Relic Logo" className="w-full h-full object-contain" />
        </div>
      </div>
      <div className="absolute inset-0 rounded-lg border border-[#4e5a6a]/15 pointer-events-none" />
    </div>
  );
}
