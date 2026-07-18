import type { QueryResult as DBQueryResult } from "@/lib/db/types";

export type QueryResult = DBQueryResult;

export interface ResultsViewerProps {
  result: QueryResult | null;
  error: string | null;
  loading?: boolean;
  schema?: string;
  table?: string;
  onRefresh?: () => void;
  enableCRUD?: boolean;
  provider?: string;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  showPagination?: boolean;
}

export const ITEMS_PER_PAGE = 500;
export const PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000];
