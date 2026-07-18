export interface Schema { name: string; tables?: Table[]; }
export interface Table { schema: string; name: string; rowCount?: number; }
export interface SchemaExplorerProps {
  connectionId?: string;
  onTableSelect?: (schema: string, table: string) => void;
  onOpenNewTableTab?: (schema: string) => void;
}
