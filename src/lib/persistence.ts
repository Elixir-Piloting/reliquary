const STORAGE_PREFIX = "relic_";

export interface QueryHistoryEntry {
  query: string;
  pinned: boolean;
  addedAt: string;
}

export const Persistence = {
  getActiveConnectionId(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`${STORAGE_PREFIX}active_connection`);
  },

  setActiveConnectionId(connectionId: string | null): void {
    if (typeof window === "undefined") return;
    if (connectionId) localStorage.setItem(`${STORAGE_PREFIX}active_connection`, connectionId);
    else localStorage.removeItem(`${STORAGE_PREFIX}active_connection`);
  },

  getActiveView(connectionId: string): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`${STORAGE_PREFIX}view_${connectionId}`);
  },

  setActiveView(connectionId: string, view: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(`${STORAGE_PREFIX}view_${connectionId}`, view);
  },

  getTableTabs(connectionId: string): Array<{ id: string; schema: string; table: string; label: string; type?: "view" | "create" | "edit" }> {
    if (typeof window === "undefined") return [];
    try { const stored = localStorage.getItem(`${STORAGE_PREFIX}tabs_${connectionId}`); return stored ? JSON.parse(stored) : []; }
    catch { return []; }
  },

  setTableTabs(connectionId: string, tabs: Array<{ id: string; schema: string; table: string; label: string; type?: "view" | "create" | "edit" }>): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(`${STORAGE_PREFIX}tabs_${connectionId}`, JSON.stringify(tabs));
  },

  getActiveTabId(connectionId: string): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`${STORAGE_PREFIX}active_tab_${connectionId}`);
  },

  setActiveTabId(connectionId: string, tabId: string | null): void {
    if (typeof window === "undefined") return;
    if (tabId) localStorage.setItem(`${STORAGE_PREFIX}active_tab_${connectionId}`, tabId);
    else localStorage.removeItem(`${STORAGE_PREFIX}active_tab_${connectionId}`);
  },

  setExpandedSchemas(connectionId: string, schemas: string[]): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(`${STORAGE_PREFIX}expanded_schemas_${connectionId}`, JSON.stringify(schemas));
  },

  getExpandedSchemas(connectionId: string): string[] {
    if (typeof window === "undefined") return [];
    try { const stored = localStorage.getItem(`${STORAGE_PREFIX}expanded_schemas_${connectionId}`); return stored ? JSON.parse(stored) : ["public"]; }
    catch { return ["public"]; }
  },

  getSelectedSchema(connectionId: string): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`${STORAGE_PREFIX}selected_schema_${connectionId}`);
  },

  setSelectedSchema(connectionId: string, schema: string | null): void {
    if (typeof window === "undefined") return;
    if (schema) localStorage.setItem(`${STORAGE_PREFIX}selected_schema_${connectionId}`, schema);
    else localStorage.removeItem(`${STORAGE_PREFIX}selected_schema_${connectionId}`);
  },

  getExpandedTables(connectionId: string): string[] {
    if (typeof window === "undefined") return [];
    try { const stored = localStorage.getItem(`${STORAGE_PREFIX}expanded_tables_${connectionId}`); return stored ? JSON.parse(stored) : []; }
    catch { return []; }
  },

  setExpandedTables(connectionId: string, keys: string[]): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(`${STORAGE_PREFIX}expanded_tables_${connectionId}`, JSON.stringify(keys));
  },

  getQueryTabs(connectionId: string): Array<{ id: string; label: string; query: string }> {
    if (typeof window === "undefined") return [];
    try { const stored = localStorage.getItem(`${STORAGE_PREFIX}query_tabs_${connectionId}`); return stored ? JSON.parse(stored) : []; }
    catch { return []; }
  },

  setQueryTabs(connectionId: string, tabs: Array<{ id: string; label: string; query: string }>): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(`${STORAGE_PREFIX}query_tabs_${connectionId}`, JSON.stringify(tabs));
  },

  getActiveQueryTabId(connectionId: string): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`${STORAGE_PREFIX}active_query_tab_${connectionId}`);
  },

  setActiveQueryTabId(connectionId: string, tabId: string | null): void {
    if (typeof window === "undefined") return;
    if (tabId) localStorage.setItem(`${STORAGE_PREFIX}active_query_tab_${connectionId}`, tabId);
    else localStorage.removeItem(`${STORAGE_PREFIX}active_query_tab_${connectionId}`);
  },

  setQueryTabContent(connectionId: string, tabId: string, query: string): void {
    if (typeof window === "undefined") return;
    const tabs = this.getQueryTabs(connectionId);
    this.setQueryTabs(connectionId, tabs.map(t => t.id === tabId ? { ...t, query } : t));
  },

  getQueryHistory(connectionId: string): QueryHistoryEntry[] {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}query_history_${connectionId}`);
      const parsed = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(parsed)) return [];
      // One-time migration: the pre-1.0 format was a plain string list.
      return parsed.map((q): QueryHistoryEntry => {
        if (typeof q === "string") return { query: q, pinned: false, addedAt: "" };
        return { query: String(q.query ?? ""), pinned: !!q.pinned, addedAt: String(q.addedAt || "") };
      }).filter(e => e.query.trim() !== "");
    } catch { return []; }
  },

  addQueryToHistory(connectionId: string, query: string): void {
    if (typeof window === "undefined") return;
    const trimmed = query.trim();
    if (!trimmed) return;
    const history = this.getQueryHistory(connectionId);
    // Dedup by query text, preserving the pinned flag of the older entry.
    let pinned = false;
    const deduped = history.filter(h => {
      if (h.query !== trimmed) return true;
      pinned = h.pinned;
      return false;
    });
    deduped.unshift({ query: trimmed, pinned, addedAt: new Date().toISOString() });
    // Keep pinned entries even when the cap is hit; evict oldest unpinned first.
    const pinnedEntries = deduped.filter(h => h.pinned);
    const unpinned = deduped.filter(h => !h.pinned);
    const kept = [...pinnedEntries, ...unpinned].slice(0, 100);
    localStorage.setItem(`${STORAGE_PREFIX}query_history_${connectionId}`, JSON.stringify(kept));
  },

  toggleQueryPinned(connectionId: string, query: string): void {
    if (typeof window === "undefined") return;
    const history = this.getQueryHistory(connectionId);
    const next = history.map(h => h.query === query ? { ...h, pinned: !h.pinned } : h);
    localStorage.setItem(`${STORAGE_PREFIX}query_history_${connectionId}`, JSON.stringify(next));
  },

  removeQueryFromHistory(connectionId: string, query: string): void {
    if (typeof window === "undefined") return;
    const history = this.getQueryHistory(connectionId).filter(h => h.query !== query);
    localStorage.setItem(`${STORAGE_PREFIX}query_history_${connectionId}`, JSON.stringify(history));
  },

  clearQueryHistory(connectionId: string): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(`${STORAGE_PREFIX}query_history_${connectionId}`);
  },

  getSafeMode(connectionId: string): boolean {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(`${STORAGE_PREFIX}safe_mode_${connectionId}`);
    return stored === null ? true : stored === "true";
  },

  setSafeMode(connectionId: string, enabled: boolean): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(`${STORAGE_PREFIX}safe_mode_${connectionId}`, String(enabled));
  },

  getQueryResultsHeight(): number {
    if (typeof window === "undefined") return 384;
    const stored = localStorage.getItem(`${STORAGE_PREFIX}query_results_height`);
    const parsed = stored ? Number(stored) : 384;
    return Number.isFinite(parsed) && parsed >= 80 ? parsed : 384;
  },

  setQueryResultsHeight(height: number): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(`${STORAGE_PREFIX}query_results_height`, String(height));
  },

  getRightSidebarWidth(): number | null {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(`${STORAGE_PREFIX}right_sidebar_width`);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) && parsed >= 260 ? parsed : null;
  },

  setRightSidebarWidth(width: number): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(`${STORAGE_PREFIX}right_sidebar_width`, String(width));
  },

  getWorkspaceTabs(connectionId: string): Array<any> {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}workspace_tabs_${connectionId}`);
      if (stored) return JSON.parse(stored);
    } catch { /* fall through to migration */ }
    const migrated = this.migrateWorkspaceTabs(connectionId);
    this.setWorkspaceTabs(connectionId, migrated);
    return migrated;
  },

  setWorkspaceTabs(connectionId: string, tabs: Array<any>): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(`${STORAGE_PREFIX}workspace_tabs_${connectionId}`, JSON.stringify(tabs));
  },

  getActiveWorkspaceTabId(connectionId: string): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`${STORAGE_PREFIX}workspace_active_${connectionId}`);
  },

  setActiveWorkspaceTabId(connectionId: string, tabId: string | null): void {
    if (typeof window === "undefined") return;
    if (tabId) localStorage.setItem(`${STORAGE_PREFIX}workspace_active_${connectionId}`, tabId);
    else localStorage.removeItem(`${STORAGE_PREFIX}workspace_active_${connectionId}`);
  },

  /** Combine previously-separate table tabs and query tabs into one workspace tab list. */
  migrateWorkspaceTabs(connectionId: string): Array<any> {
    const tableTabs = this.getTableTabs(connectionId).map(t => {
      if (t.type === "create") return { kind: "create", id: t.id, schema: t.schema, table: "", label: t.label };
      if (t.type === "edit") return { kind: "edit", id: t.id, schema: t.schema, table: t.table, label: t.label };
      return { kind: "table", id: t.id, schema: t.schema, table: t.table, label: t.label };
    });
    const queryTabs = this.getQueryTabs(connectionId).map(q => ({ kind: "query", id: q.id, label: q.label, query: q.query }));
    const oldActive = this.getActiveTabId(connectionId);
    const oldActiveQuery = this.getActiveQueryTabId(connectionId);
    const all = [...tableTabs, ...queryTabs];
    const active = oldActive && tableTabs.find(t => t.id === oldActive) ? oldActive
      : oldActiveQuery && queryTabs.find(t => t.id === oldActiveQuery) ? oldActiveQuery
      : all[0]?.id || null;
    if (active) this.setActiveWorkspaceTabId(connectionId, active);
    return all;
  },

  };
