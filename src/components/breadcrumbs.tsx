"use client";
import { useLocation, Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items?: BreadcrumbItem[];
  className?: string;
}

function useBreadcrumbs(items?: BreadcrumbItem[]): BreadcrumbItem[] {
  const location = useLocation();
  if (items && items.length > 0) return items;

  const segments = location.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [{ label: "Home", href: "/" }];

  let path = "";
  return segments.map((seg, i) => {
    path += `/${seg}`;
    const label = seg.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    return { label, href: i < segments.length - 1 ? path : undefined };
  });
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  const breadcrumbs = useBreadcrumbs(items);
  if (breadcrumbs.length <= 1) return null;

  return (
    <nav className={cn("flex items-center gap-1 text-sm", className)}>
      {breadcrumbs.map((crumb, i) => (
        <div key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground/50" />}
          {crumb.href ? (
            <Link to={crumb.href} className="text-muted-foreground hover:text-foreground transition-colors">{crumb.label}</Link>
          ) : (
            <span className="text-foreground font-medium">{crumb.label}</span>
          )}
        </div>
      ))}
    </nav>
  );
}
