"use client";
import { createContext, useCallback, useContext, useState, ReactNode } from "react";

interface RightSidebarContextType {
  open: boolean;
  content: ReactNode;
  setOpen: (open: boolean) => void;
  setContent: (content: ReactNode) => void;
  /** Set content AND open the sidebar (insert row, etc.). */
  openRight: (content: ReactNode) => void;
  /** Slide the sidebar closed, keeping the current content mounted. */
  closeRight: () => void;
  /** Close and drop content (component unmount). */
  clearRight: () => void;
}

const RightSidebarContext = createContext<RightSidebarContextType>({
  open: false,
  content: null,
  setOpen: () => {},
  setContent: () => {},
  openRight: () => {},
  closeRight: () => {},
  clearRight: () => {},
});

export function RightSidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<ReactNode>(null);

  const openRight = useCallback((c: ReactNode) => {
    setContent(c);
    setOpen(true);
  }, []);
  const closeRight = useCallback(() => setOpen(false), []);
  const clearRight = useCallback(() => {
    setOpen(false);
    setContent(null);
  }, []);

  return (
    <RightSidebarContext.Provider value={{ open, content, setOpen, setContent, openRight, closeRight, clearRight }}>
      {children}
    </RightSidebarContext.Provider>
  );
}

export function useRightSidebar() {
  return useContext(RightSidebarContext);
}
