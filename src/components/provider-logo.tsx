"use client";
import { cn } from "@/lib/utils";

/**
 * Provider logos used on connection cards. Neon and Supabase are rendered as
 * inline SVGs; everything else (local/regular PostgreSQL) uses the packaged
 * postgresql icon image.
 */
export function ProviderLogo({ provider, className }: { provider?: string; className?: string }) {
  if (provider === "neon") return <NeonLogo className={className} />;
  if (provider === "supabase") return <SupabaseLogo className={className} />;
  return (
    <div className={cn("relative shrink-0 rounded-lg overflow-hidden bg-[#336791]/10 flex items-center justify-center", className)}>
      <img src="/icons/postgresql.png" alt="PostgreSQL" className="w-full h-full object-contain" />
    </div>
  );
}

function NeonLogo({ className }: { className?: string }) {
  return (
    <div className={cn("relative shrink-0 rounded-lg overflow-hidden bg-[#00E599]/10 flex items-center justify-center", className)}>
      <svg viewBox="0 0 48 48" className="w-full h-full p-1.5" fill="none" aria-hidden>
        <path d="M10 34V14c0-1.1.9-2 2-2h10c4.4 0 8 3.6 8 8s-3.6 8-8 8H14" stroke="#00E599" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 28l14 8" stroke="#B39DFF" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function SupabaseLogo({ className }: { className?: string }) {
  return (
    <div className={cn("relative shrink-0 rounded-lg overflow-hidden bg-[#3ECF8E]/10 flex items-center justify-center", className)}>
      <svg viewBox="0 0 48 48" className="w-full h-full p-1.5" fill="none" aria-hidden>
        <path d="M12 28L28 8h8l-6 14h7L20 42l4-14h-12z" fill="#3ECF8E" />
      </svg>
    </div>
  );
}
