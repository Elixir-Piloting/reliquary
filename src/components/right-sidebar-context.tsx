"use client";
import { createContext, useCallback, useContext, useState, ReactNode } from "react";

interface RightSidebarContextType {
  open: boolean;
  content: ReactNode;
  openRight: (content: ReactNode) => void;
  closeRight: () => void;
}

const RightSidebarContext = createContext<RightSidebarContextType>({
  open: false,
  content: null,
  openRight: () => {},
  closeRight: () => {},
});

export function RightSidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<ReactNode>(null);

  const openRight = useCallback((c: ReactNode) => {
    setContent(c);
    setOpen(true);
  }, []);
  const closeRight = useCallback(() => {
    setOpen(false);
    setContent(null);
  }, []);

  return (
    <RightSidebarContext.Provider value={{ open, content, openRight, closeRight }}>
      {children}
    </RightSidebarContext.Provider>
  );
}

export function useRightSidebar() {
  return useContext(RightSidebarContext);
}
