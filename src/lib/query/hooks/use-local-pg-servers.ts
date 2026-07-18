import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import API, { LocalPgDatabase, LocalPgServer } from "@/lib/ipc-client";
import { queryKeys } from "../keys";

export function useLocalServers() {
  return useQuery<LocalPgServer[]>({
    queryKey: queryKeys.localPg.servers,
    queryFn: API.detectLocalServers,
    refetchInterval: 30000,
  });
}

export function useLocalPgDatabases() {
  return useMutation({
    mutationFn: ({ host, port, user, password }: { host: string; port: number; user?: string; password?: string }) =>
      API.listLocalDatabases(host, port, user, password),
  });
}

export function useCreateLocalDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ host, port, dbName, user, password }: { host: string; port: number; dbName: string; user?: string; password?: string }) =>
      API.createLocalDatabase(host, port, dbName, user, password),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.localPg.databases(`${vars.host}:${vars.port}`) });
    },
  });
}

export function useDropLocalDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ host, port, dbName, user, password }: { host: string; port: number; dbName: string; user?: string; password?: string }) =>
      API.dropLocalDatabase(host, port, dbName, user, password),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.localPg.databases(`${vars.host}:${vars.port}`) });
    },
  });
}
