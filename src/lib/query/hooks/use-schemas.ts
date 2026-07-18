import { useQuery } from "@tanstack/react-query";
import API from "@/lib/ipc-client";
import { queryKeys } from "../keys";

export function useSchemas(connectionId: string) {
  return useQuery({
    queryKey: queryKeys.db.schema(connectionId),
    queryFn: () => API.getSchemas(connectionId),
    enabled: !!connectionId,
  });
}
