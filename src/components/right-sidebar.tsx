"use client";
import { ReactNode, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Persistence } from "@/lib/persistence";

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
 * database navbar. A drag handle on the left edge lets the user resize the
 * panel (highlighted in the theme color on hover, like the left sidebar).
 */
export function RightSidebar({ open, children, width: defaultWidth = 380 }: RightSidebarProps) {
  const [width, setWidth] = useState(() => Persistence.getRightSidebarWidth() ?? defaultWidth);
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let finalWidth = startWidth;
    const onMove = (ev: PointerEvent) => {
      finalWidth = Math.min(Math.max(startWidth + (startX - ev.clientX), 260), 720);
      setWidth(finalWidth);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      Persistence.setRightSidebarWidth(finalWidth);
    };
    setDragging(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [width]);

  return (
    <aside
      ref={asideRef}
      className={cn(
        "h-full shrink-0 overflow-hidden border-l border-border bg-background",
        dragging || !open ? "transition-none" : "transition-[width] duration-300 ease-in-out",
        !open && "border-l-transparent"
      )}
      style={{ width: open ? width : 0 }}
      aria-hidden={!open}
    >
      <div className="relative flex h-full w-full flex-col">
        {open && (
          <div
            onPointerDown={onResizeStart}
            className="group/resize absolute inset-y-0 left-0 -ml-1 w-2.5 cursor-col-resize z-20 flex justify-center"
            title="Drag to resize"
          >
            <div className={cn("w-px h-full transition-colors",
              dragging ? "bg-primary" : "bg-primary/0 group-hover/resize:bg-primary/50")} />
          </div>
        )}
        {children}
      </div>
    </aside>
  );
}
