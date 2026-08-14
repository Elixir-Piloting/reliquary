"use client";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Cards, Square, Minus, X, CopySimple } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => { unlisten.then(fn => fn()).catch(() => {}); };
  }, []);

  const minimize = () => getCurrentWindow().minimize();
  const toggleMaximize = () => getCurrentWindow().toggleMaximize();
  const close = () => getCurrentWindow().close();

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-8 px-2 bg-muted/20 border-b border-border shrink-0 select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-2">
        <Cards size={16} weight="duotone" className="text-primary" data-tauri-drag-region />
        <span data-tauri-drag-region className="text-xs font-semibold text-muted-foreground">Relic</span>
      </div>
      <div className="flex items-center gap-0.5">
        <button onClick={minimize} className="flex h-6 w-8 items-center justify-center rounded transition-colors hover:bg-accent" title="Minimize">
          <Minus size={14} />
        </button>
        <button onClick={toggleMaximize} className="flex h-6 w-8 items-center justify-center rounded transition-colors hover:bg-accent" title={maximized ? "Restore" : "Maximize"}>
          {maximized ? <CopySimple size={12} /> : <Square size={12} />}
        </button>
        <button onClick={close} className="flex h-6 w-8 items-center justify-center rounded transition-colors hover:bg-destructive hover:text-destructive-foreground" title="Close">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}