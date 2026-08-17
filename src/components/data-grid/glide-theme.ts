"use client";
import { getDefaultTheme, type Theme } from "@glideapps/glide-data-grid";

/**
 * Build a Glide theme that matches the app's shadcn/Tailwind tokens for light or
 * dark mode (driven by the `.dark` class on <html>).
 */
export function glideTheme(dark: boolean): Theme {
  const base = getDefaultTheme();
  const isDark = dark;
  // Match the app's shadcn tokens exactly (see src/index.css).
  const text = isDark ? "hsl(0, 0%, 96%)" : "hsl(240, 6%, 10%)";        // --foreground
  const textMuted = isDark ? "hsl(240, 5%, 55%)" : "hsl(240, 4%, 40%)"; // --muted-foreground
  const bgCell = isDark ? "hsl(0, 0%, 0%)" : "hsl(0, 0%, 98%)";         // --background
  const bgHeader = isDark ? "hsl(240, 6%, 6%)" : "hsl(240, 4%, 97%)";   // --table-header
  const border = isDark ? "hsl(240, 4%, 18%)" : "hsl(240, 5%, 88%)";    // --border
  const accent = "hsl(221, 100%, 50%)";                                 // --primary
  const accentLight = isDark ? "hsl(221, 100%, 45%, 0.25)" : "hsl(221, 100%, 50%, 0.15)";

  return {
    ...base,
    accentColor: accent,
    accentFg: "hsl(0, 0%, 100%)",
    accentLight,
    textDark: text,
    textMedium: textMuted,
    textLight: textMuted,
    textHeader: isDark ? "hsl(240, 5%, 55%)" : "hsl(240, 4%, 40%)",
    textHeaderSelected: text,
    bgCell,
    bgCellMedium: bgHeader,
    bgHeader,
    bgHeaderHasFocus: bgHeader,
    bgHeaderHovered: isDark ? "hsl(240, 4%, 14%)" : "hsl(240, 5%, 96%)",
    borderColor: border,
    horizontalBorderColor: border,
    headerBottomBorderColor: border,
    cellHorizontalPadding: 12,
    cellVerticalPadding: 9,
    lineHeight: 1.6,
    editorFontSize: "16px",
    headerFontStyle: "600 16px",
    baseFontStyle: "16px",
    markerFontStyle: "600 16px",
    fontFamily: "'Outfit', -apple-system, system-ui, sans-serif",
    resizeIndicatorColor: accent,
    roundingRadius: 0,
  };
}
