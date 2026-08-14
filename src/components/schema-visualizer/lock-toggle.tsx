"use client";
import { Lock, LockOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface LockToggleProps {
  locked: boolean;
  onToggle: (locked: boolean) => void;
  className?: string;
}

/** Lock toggle: filled accent (blue) when locked, muted/whitish when unlocked. */
export function LockToggle({ locked, onToggle, className }: LockToggleProps) {
  return (
    <button
      onClick={() => onToggle(!locked)}
      title={locked ? "Unlock canvas (allow editing)" : "Lock canvas (prevent edits)"}
      className={cn("flex items-center gap-1 rounded p-1 transition-colors hover:bg-accent", className)}
    >
      {locked ? (
        <Lock className={cn("h-4 w-4", "text-primary")} />
      ) : (
        <LockOpen className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  );
}
