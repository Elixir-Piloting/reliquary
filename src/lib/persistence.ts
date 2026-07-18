const STORAGE_PREFIX = "relic_";

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

  getTableTabs(connectionId: string): Array<{ id: string; schema: string; table: string; label: string; type?: "view" | "create" }> {
    if (typeof window === "undefined") return [];
    try { const stored = localStorage.getItem(`${STORAGE_PREFIX}tabs_${connectionId}`); return stored ? JSON.parse(stored) : []; }
    catch { return []; }
  },

  setTableTabs(connectionId: string, tabs: Array<{ id: string; schema: string; table: string; label: string; type?: "view" | "create" }>): void {
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

  getSafeMode(connectionId: string): boolean {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(`${STORAGE_PREFIX}safe_mode_${connectionId}`);
    return stored === null ? true : stored === "true";
  },

  setSafeMode(connectionId: string, enabled: boolean): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(`${STORAGE_PREFIX}safe_mode_${connectionId}`, String(enabled));
  },

  getServerPassword(host: string, port: number): { user: string; password: string } | null {
    if (typeof window === "undefined") return null;
    try { const stored = localStorage.getItem(`${STORAGE_PREFIX}server_${host}_${port}`); return stored ? JSON.parse(stored) : null; }
    catch { return null; }
  },

  setServerPassword(host: string, port: number, user: string, password: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(`${STORAGE_PREFIX}server_${host}_${port}`, JSON.stringify({ user, password }));
  },

  removeServerPassword(host: string, port: number): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(`${STORAGE_PREFIX}server_${host}_${port}`);
  },
};
