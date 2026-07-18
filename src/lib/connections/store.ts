import type { ConnectionConfig } from "@/lib/db/types";

const STORAGE_KEY = "relic-connections";

export function getConnections(): ConnectionConfig[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

export function saveConnections(connections: ConnectionConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
}

export function addConnection(conn: ConnectionConfig): void {
  const connections = getConnections();
  connections.push(conn);
  saveConnections(connections);
}

export function updateConnection(id: string, updates: Partial<ConnectionConfig>): void {
  const connections = getConnections().map(c => c.id === id ? { ...c, ...updates } : c);
  saveConnections(connections);
}

export function deleteConnection(id: string): void {
  saveConnections(getConnections().filter(c => c.id !== id));
}

export function getConnection(id: string): ConnectionConfig | undefined {
  return getConnections().find(c => c.id === id);
}
