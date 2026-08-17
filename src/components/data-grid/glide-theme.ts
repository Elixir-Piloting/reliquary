"use client";
import { getDefaultTheme, type Theme } from "@glideapps/glide-data-grid";

/**
 * Build a Glide theme that matches the app's shadcn/Tailwind tokens for light or
 * dark mode (driven by the `.dark` class on <html>).
 */
export function glideTheme(dark: boolean): Theme {
  const base = getDefaultTheme();
  const isDark = dark;
  const text = isDark ? "hsl(0, 0%, 96%)" : "hsl(240, 6%, 10%)";
  const textMuted = isDark ? "hsl(240, 5%, 55%)" : "hsl(240, 4%, 40%)";
  const bgCell = isDark ? "hsl(240, 6%, 5%)" : "hsl(0, 0%, 100%)";
  const bgCellMedium = isDark ? "hsl(240, 6%, 8%)" : "hsl(240, 5%, 96%)";
  const bgHeader = isDark ? "hsl(240, 6%, 6%)" : "hsl(240, 4%, 97%)";
  const border = isDark ? "hsl(240, 4%, 18%)" : "hsl(240, 5%, 88%)";
  const accent = "hsl(221, 100%, 50%)"; // --primary
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
    bgCellMedium,
    bgHeader,
    bgHeaderHasFocus: bgHeader,
    bgHeaderHovered: bgCellMedium,
    borderColor: border,
    horizontalBorderColor: border,
    headerBottomBorderColor: border,
    cellHorizontalPadding: 8,
    cellVerticalPadding: 6,
    lineHeight: 1.4,
    editorFontSize: "13px",
    headerFontStyle: "600 12px system-ui, -apple-system, sans-serif",
    baseFontStyle: "13px system-ui, -apple-system, sans-serif",
    markerFontStyle: "600 12px system-ui, -apple-system, sans-serif",
    fontFamily: "Outfit, -apple-system, system-ui, sans-serif",
    resizeIndicatorColor: accent,
    roundingRadius: 0,
  };
}
