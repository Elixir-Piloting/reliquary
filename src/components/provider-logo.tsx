"use client";
import { cn } from "@/lib/utils";

const LOGO_BG: Record<string, string> = {
  neon: "bg-[#000000]/40",
  supabase: "bg-[#1c1c1c]/40",
  postgresql: "bg-[#336791]/10",
};

/**
 * Provider logos used on connection cards. Neon and Supabase use their real
 * brand logos (fetched from logo.dev); everything else (local/regular
 * PostgreSQL) uses the packaged postgresql icon image.
 */
export function ProviderLogo({ provider, className }: { provider?: string; className?: string }) {
  const p = provider || "postgresql";
  if (p === "neon" || p === "supabase") {
    return (
      <div className={cn("relative shrink-0 rounded-lg overflow-hidden flex items-center justify-center", LOGO_BG[p], className)}>
        <img src={`/icons/${p}.png`} alt={p} className="w-full h-full object-contain p-1" />
      </div>
    );
  }
  return (
    <div className={cn("relative shrink-0 rounded-lg overflow-hidden flex items-center justify-center", LOGO_BG.postgresql, className)}>
      <img src="/icons/postgresql.png" alt="PostgreSQL" className="w-full h-full object-contain" />
    </div>
  );
}
