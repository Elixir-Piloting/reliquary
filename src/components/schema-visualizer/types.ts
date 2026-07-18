export interface ColumnInfo {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isNullable: boolean;
}

export interface TableNode {
  id: string;
  schema: string;
  name: string;
  columns: ColumnInfo[];
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
}

export interface RelationshipEdge {
  id: string;
  from: string;
  to: string;
  fromColumn: string;
  toColumn: string;
  constraintName?: string;
}

export const TABLE_HEADER_HEIGHT = 32;
export const COLUMN_HEIGHT = 24;
export const TABLE_MIN_WIDTH = 280;
export const TABLE_PADDING = 12;
