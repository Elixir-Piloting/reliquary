import { useQuery } from "@tanstack/react-query";
import API, { TableDataResult } from "@/lib/ipc-client";
import { queryKeys } from "../keys";

export function useTableData(
  connectionId: string,
  schema: string,
  table: string,
  page: number,
  pageSize: number,
) {
  return useQuery<TableDataResult>({
    queryKey: queryKeys.db.tableData(connectionId, schema, table, page, pageSize),
    queryFn: () => API.getTableData(connectionId, schema, table, page, pageSize),
    enabled: !!connectionId && !!schema && !!table,
  });
}

export function useTableColumns(connectionId: string, schema: string, table: string) {
  return useQuery({
    queryKey: queryKeys.db.columns(connectionId, schema, table),
    queryFn: () => API.getColumns(connectionId, schema, table),
    enabled: !!connectionId && !!schema && !!table,
  });
}

export function useTableIndexes(connectionId: string, schema: string, table: string) {
  return useQuery({
    queryKey: queryKeys.db.indexes(connectionId, schema, table),
    queryFn: () => API.getIndexes(connectionId, schema, table),
    enabled: !!connectionId && !!schema && !!table,
  });
}

export function useTableConstraints(connectionId: string, schema: string, table: string) {
  return useQuery({
    queryKey: queryKeys.db.constraints(connectionId, schema, table),
    queryFn: () => API.getConstraints(connectionId, schema, table),
    enabled: !!connectionId && !!schema && !!table,
  });
}

export function useTableRelationships(connectionId: string, schema: string, table: string) {
  return useQuery({
    queryKey: queryKeys.db.relationships(connectionId, schema, table),
    queryFn: () => API.getRelationships(connectionId, schema, table),
    enabled: !!connectionId && !!schema && !!table,
  });
}
