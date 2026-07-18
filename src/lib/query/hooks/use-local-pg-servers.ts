import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import API, { LocalPgDatabase, LocalPgServer } from "@/lib/ipc-client";
import { queryKeys } from "../keys";

export function useDetectLocalServers() {
  return useMutation<LocalPgServer[], Error, void>({
    mutationFn: () => API.detectLocalServers(),
  });
}

export function useLocalServers() {
  return useQuery<LocalPgServer[]>({
    queryKey: queryKeys.localPg.servers,
    queryFn: API.detectLocalServers,
    refetchInterval: 30000,
  });
}

export function useLocalDatabases(server: { host: string; port: number } | null) {
  return useQuery<LocalPgDatabase[]>({
    queryKey: queryKeys.localPg.databases(`${server?.host}:${server?.port}`),
    queryFn: () => API.listLocalDatabases(server!.host, server!.port),
    enabled: !!server,
  });
}

export function useCreateLocalDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ host, port, dbName }: { host: string; port: number; dbName: string }) =>
      API.createLocalDatabase(host, port, dbName),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.localPg.databases(`${vars.host}:${vars.port}`) });
    },
  });
}

export function useDropLocalDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ host, port, dbName }: { host: string; port: number; dbName: string }) =>
      API.dropLocalDatabase(host, port, dbName),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.localPg.databases(`${vars.host}:${vars.port}`) });
    },
  });
}
