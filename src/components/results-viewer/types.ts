import type { QueryResult as DBQueryResult, RowMutationStatement } from "@/lib/db/types";

export type QueryResult = DBQueryResult;

export interface ResultsViewerProps {
  result: QueryResult | null;
  error: string | null;
  loading?: boolean;
  schema?: string;
  table?: string;
  onRefresh?: () => void;
  enableCRUD?: boolean;
  readOnly?: boolean;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  showPagination?: boolean;
  connectionId?: string;
  pkColumns?: string[];
  onAddColumn?: () => void;
}

export type PendingChangeOp = "update" | "insert" | "delete";

export interface PendingChange {
  id: string;
  schema: string;
  table: string;
  op?: PendingChangeOp;
  columnName: string;
  dataType: string;
  pkValues: Record<string, unknown>;
  originalValue: unknown;
  newValue: unknown;
  statement?: RowMutationStatement;
}

export const ITEMS_PER_PAGE = 500;
export const PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000];
