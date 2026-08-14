export type WorkspaceTab =
  | { kind: "table"; id: string; schema: string; table: string; label: string }
  | { kind: "create"; id: string; schema: string; table: string; label: string }
  | { kind: "edit"; id: string; schema: string; table: string; label: string }
  | { kind: "query"; id: string; label: string; query: string }
  | { kind: "visualizer"; id: string; label: string }
  | { kind: "tables"; id: string; label: string };

export function generateTabId(): string {
  return "t-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
}
