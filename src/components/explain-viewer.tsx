"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlanNode {
  "Node Type"?: string;
  "Relation Name"?: string;
  "Schema"?: string;
  "Alias"?: string;
  "Plan Rows"?: number;
  "Startup Cost"?: number;
  "Total Cost"?: number;
  "Actual Rows"?: number;
  "Actual Total Time"?: number;
  "Actual Loops"?: number;
  "Plans"?: PlanNode[];
  [key: string]: unknown;
}

const METRIC_KEYS = ["Actual Rows", "Actual Total Time", "Actual Loops", "Plan Rows", "Startup Cost", "Total Cost"] as const;

function PlanNodeRow({ node, depth }: { node: PlanNode; depth: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = Array.isArray(node["Plans"]) && node["Plans"].length > 0;
  const metrics = METRIC_KEYS
    .filter(k => node[k] !== undefined)
    .map(k => `${k}: ${node[k]}`)
    .join(" · ");
  const qualifiedName = node["Schema"] ? `${node["Schema"]}.${node["Relation Name"]}` : node["Relation Name"];

  return (
    <div className={cn(depth > 0 && "border-l border-border ml-1.5 pl-2")}>
      <div className="flex items-baseline gap-2 rounded px-1 py-0.5 hover:bg-accent/40">
        <button
          onClick={() => setOpen(o => !o)}
          disabled={!hasChildren}
          className={cn("flex h-4 w-4 shrink-0 items-center justify-center", !hasChildren && "opacity-0")}
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <span className="font-semibold whitespace-nowrap">{node["Node Type"] || "Plan"}</span>
        {qualifiedName && <span className="whitespace-nowrap font-mono text-muted-foreground">{qualifiedName}</span>}
        {node["Alias"] && <span className="whitespace-nowrap text-muted-foreground">as {node["Alias"]}</span>}
        {metrics && <span className="truncate text-muted-foreground">{metrics}</span>}
      </div>
      {open && hasChildren && (
        <div>
          {node["Plans"]!.map((child, i) => <PlanNodeRow key={i} node={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

interface ExplainViewerProps {
  plan: unknown;
  executionTimeMs?: number;
}

export function ExplainViewer({ plan, executionTimeMs }: ExplainViewerProps) {
  const [showRaw, setShowRaw] = useState(false);
  const entries = Array.isArray(plan) ? plan : [plan];

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide">Execution Plan</span>
        {executionTimeMs !== undefined && <span className="text-xs text-muted-foreground">· {executionTimeMs} ms</span>}
        <div className="flex-1" />
        <button onClick={() => setShowRaw(s => !s)} className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
          Raw JSON
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2 font-mono text-xs leading-relaxed">
        {entries.map((entry, i) => {
          const node = entry && typeof entry === "object" && "Plan" in entry ? (entry as { Plan: PlanNode }).Plan : entry as PlanNode;
          return <PlanNodeRow key={i} node={node} depth={0} />;
        })}
      </div>
      {showRaw && (
        <div className="shrink-0 border-t border-border">
          <pre className="max-h-64 overflow-auto p-3 font-mono text-xs">{JSON.stringify(plan, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
