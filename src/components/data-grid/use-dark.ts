"use client";
import { useState, useEffect } from "react";

export function isDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/** Reactively track dark mode via a MutationObserver on <html>. */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(isDarkMode);
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(isDarkMode()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
