"use client";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface RightSidebarProps {
  open: boolean;
  children: ReactNode;
  width?: number;
}

/**
 * A full-height panel fixed to the right edge of the app layout — the mirror
 * of the left sidebar. It is rendered at the top level of `MainLayout` as a
 * flex-row sibling, so it spans the whole window height and *pushes* (shrinks)
 * the main content rather than overlaying it.
 *
 * The panel is always mounted; `open` only toggles its width, which CSS
 * transitions so it visibly slides in/out (no exit/remount). Content is
 * supplied via the right-sidebar context; closing is handled by a
 * chevron-right button in the content header and a chevron-left toggle in the
 * database navbar.
 */
export function RightSidebar({ open, children, width = 380 }: RightSidebarProps) {
  return (
    <aside
      className={cn(
        "h-full shrink-0 overflow-hidden border-l border-border bg-background transition-[width] duration-300 ease-in-out",
        !open && "border-l-transparent"
      )}
      style={{ width: open ? width : 0 }}
      aria-hidden={!open}
    >
      <div className="flex h-full w-[380px] flex-col">{children}</div>
    </aside>
  );
}
