import { useQuery } from "@tanstack/react-query";
import API from "@/lib/ipc-client";
import { queryKeys } from "../keys";

export function useTables(connectionId: string, schema: string) {
  return useQuery({
    queryKey: queryKeys.db.tables(connectionId, schema),
    queryFn: () => API.getTables(connectionId, schema),
    enabled: !!connectionId && !!schema,
  });
}
