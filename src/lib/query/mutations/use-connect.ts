import { useMutation, useQueryClient } from "@tanstack/react-query";
import API from "@/lib/ipc-client";
import { queryKeys } from "../keys";

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
