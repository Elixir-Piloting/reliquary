"use client";
import { DatabaseProvider, getAllProviders } from "@/lib/db/providers";

interface ProviderGridProps { onSelect?: (provider: DatabaseProvider) => void; }

export function ProviderGrid({ onSelect }: ProviderGridProps) {
  const providers = getAllProviders().filter(p => p.supported !== false);
  return (
    <div className="grid grid-cols-2 gap-3">
      {providers.map((provider) => (
        <button key={provider.id} onClick={() => onSelect?.(provider.id)}
          className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent hover:border-accent-foreground/20 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: provider.color + "20" }}>
            <img src={`/icons/${provider.id}.png`} alt={provider.name} className="w-10 h-10 object-cover rounded-full" />
          </div>
          <p className="font-medium truncate">{provider.name}</p>
        </button>
      ))}
    </div>
  );
}
