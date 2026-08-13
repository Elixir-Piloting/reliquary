export interface Schema { name: string; tables?: Table[]; }
export interface Table { schema: string; name: string; rowCount?: number; tableType?: string; hasRls?: boolean; }
export interface SchemaExplorerProps {
  connectionId?: string;
  onTableSelect?: (schema: string, table: string) => void;
  onOpenNewTableTab?: (schema: string) => void;
  onOpenTableDetails?: (schema: string, table: string) => void;
}
