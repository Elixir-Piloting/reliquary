import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import API, { Connection, TestConnectionResult } from "@/lib/ipc-client";
import { queryKeys } from "../keys";

export function useConnections() {
  return useQuery<Connection[]>({
    queryKey: queryKeys.connections.all,
    queryFn: API.listConnections,
  });
}

export function useAddConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: { name: string; url: string }) => API.addConnection(config),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.connections.all }),
  });
}

export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...rest }: { id: string; name?: string; url?: string }) => API.updateConnection(id, rest),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.connections.all }),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => API.deleteConnection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.connections.all }),
  });
}

export function useTestConnection() {
  return useMutation<TestConnectionResult, Error, string>({
    mutationFn: (url: string) => API.testConnection(url),
  });
}

export function useConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => API.connect(connectionId),
    onSuccess: (_data, connectionId) => {
      qc.invalidateQueries({ queryKey: queryKeys.db.schema(connectionId) });
      qc.invalidateQueries({ queryKey: queryKeys.db.status(connectionId) });
    },
  });
}

export function useDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => API.disconnect(connectionId),
    onSuccess: (_data, connectionId) => {
      qc.invalidateQueries({ queryKey: queryKeys.db.schema(connectionId) });
      qc.invalidateQueries({ queryKey: queryKeys.db.status(connectionId) });
    },
  });
}

export function useConnectionStatus(connectionId: string) {
  return useQuery({
    queryKey: queryKeys.db.status(connectionId),
    queryFn: () => API.isConnected(connectionId),
    enabled: !!connectionId,
  });
}
