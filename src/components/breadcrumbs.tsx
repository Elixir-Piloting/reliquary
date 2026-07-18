"use client";
import { useLocation, Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);
  
  if (segments.length === 0) return null;
  
  return (
    <nav className="flex items-center gap-2 text-sm text-muted-foreground">
      <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
      {segments.map((seg, i) => {
        const path = "/" + segments.slice(0, i + 1).join("/");
        const label = seg.includes("?") ? seg.split("?")[0] : seg;
        return (
          <span key={path} className="flex items-center gap-2">
            <span className="text-border">/</span>
            {i === segments.length - 1 ? (
              <span className="text-foreground font-medium">{decodeURIComponent(label)}</span>
            ) : (
              <Link to={path} className="hover:text-foreground transition-colors">{decodeURIComponent(label)}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
