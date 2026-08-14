"use client";
import { createContext, useContext, useState, ReactNode } from "react";

interface SidebarContextType {
  collapsed: boolean;
  toggle: () => void;
  width: number;
  setWidth: (width: number) => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  toggle: () => {},
  width: 256,
  setWidth: () => {},
});

export const SIDEBAR_MIN_WIDTH = 176;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 256;

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidthState] = useState(SIDEBAR_DEFAULT_WIDTH);

  const toggle = () => setCollapsed(prev => !prev);
  const setWidth = (w: number) =>
    setWidthState(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(w))));

  return <SidebarContext.Provider value={{ collapsed, toggle, width, setWidth }}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  return useContext(SidebarContext);
}
