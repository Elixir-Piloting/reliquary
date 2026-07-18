import { useMutation } from "@tanstack/react-query";
import API, { QueryResult } from "@/lib/ipc-client";

export function useExecuteQuery(connectionId: string) {
  return useMutation<QueryResult, Error, string>({
    mutationFn: async (query: string) => API.executeQuery(connectionId, query),
  });
}
