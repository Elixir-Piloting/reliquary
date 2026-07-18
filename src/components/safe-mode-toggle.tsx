"use client";
import { Shield, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SafeModeToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  className?: string;
}

export function SafeModeToggle({ enabled, onToggle, className }: SafeModeToggleProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant={enabled ? "default" : "outline"} size="sm" onClick={() => onToggle(!enabled)}
            className={cn("gap-2", enabled && "bg-green-600 hover:bg-green-700", className)}>
            {enabled ? <><Shield className="h-4 w-4" /><span className="hidden sm:inline">Safe Mode ON</span></>
              : <><ShieldOff className="h-4 w-4" /><span className="hidden sm:inline">Safe Mode OFF</span></>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{enabled ? "Safe Mode is ON - Destructive queries require confirmation" : "Safe Mode is OFF - All queries execute immediately"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
