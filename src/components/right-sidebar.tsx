"use client";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface RightSidebarProps {
  open: boolean;
  children: ReactNode;
  widthClass?: string;
}

/**
 * A full-height panel fixed to the right edge of the app layout — the mirror
 * of the left sidebar. It is rendered at the top level of `MainLayout`, so it
 * spans the whole window height and *pushes* (shrinks) the main content rather
 * than overlaying it. Hidden entirely (renders nothing) when `open` is false.
 */
export function RightSidebar({ open, children, widthClass = "w-[380px]" }: RightSidebarProps) {
  if (!open) return null;
  return (
    <aside className={cn("h-full shrink-0 overflow-hidden border-l border-border bg-background", widthClass)}>
      {children}
    </aside>
  );
}
