"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string;
  primaryKey: boolean;
}

const COLUMN_TYPES = ["VARCHAR", "TEXT", "INTEGER", "BIGINT", "SMALLINT", "DECIMAL", "NUMERIC", "REAL", "DOUBLE PRECISION", "BOOLEAN", "DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "UUID", "JSON", "JSONB"];

interface CreateTableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: string;
  connectionId: string;
  onTableCreated?: () => void;
}

export function CreateTableDialog({ open, onOpenChange, schema, connectionId, onTableCreated }: CreateTableDialogProps) {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnDef[]>([{ name: "id", type: "BIGINT", nullable: false, defaultValue: "", primaryKey: true }]);
  const [creating, setCreating] = useState(false);

  const addColumn = () => setColumns(prev => [...prev, { name: "", type: "TEXT", nullable: true, defaultValue: "", primaryKey: false }]);

  const removeColumn = (i: number) => setColumns(prev => prev.filter((_, idx) => idx !== i));

  const updateColumn = (i: number, field: keyof ColumnDef, value: any) => {
    setColumns(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c));
  };

  const buildCreateSQL = (): string => {
    const cols = columns.map(c => {
      let def = `"${c.name}" ${c.type}`;
      if (c.primaryKey) def += " PRIMARY KEY";
      if (!c.nullable && !c.primaryKey) def += " NOT NULL";
      if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
      return def;
    });
    return `CREATE TABLE "${schema}"."${tableName}" (\n  ${cols.join(",\n  ")}\n);`;
  };

  const handleCreate = async () => {
    if (!tableName.trim()) { toast.error("Table name is required"); return; }
    const sql = buildCreateSQL();
    setCreating(true);
    try {
      await invoke("execute_query", { connectionId, query: sql });
      toast.success(`Table "${tableName}" created`);
      onOpenChange(false);
      setTableName("");
      setColumns([{ name: "id", type: "BIGINT", nullable: false, defaultValue: "", primaryKey: true }]);
      onTableCreated?.();
    } catch (e: any) {
      toast.error("Failed to create table", { description: String(e) });
    }
    setCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Table</DialogTitle>
          <DialogDescription>Add a new table to schema "{schema}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Table Name</Label>
            <Input value={tableName} onChange={e => setTableName(e.target.value)} placeholder="table_name" />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Columns</Label>
              <Button variant="outline" size="sm" onClick={addColumn}><Plus className="h-4 w-4 mr-1" />Add Column</Button>
            </div>
            {columns.map((col, i) => (
              <div key={i} className="flex items-start gap-2 p-3 border rounded-lg bg-muted/20">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input value={col.name} onChange={e => updateColumn(i, "name", e.target.value)} placeholder="column_name" className="h-8 text-sm" />
                </div>
                <div className="w-32 space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select value={col.type} onValueChange={v => updateColumn(i, "type", v)}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{COLUMN_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="w-16 space-y-1">
                  <Label className="text-xs">PK</Label>
                  <Button variant={col.primaryKey ? "default" : "outline"} size="sm" onClick={() => updateColumn(i, "primaryKey", !col.primaryKey)} className="h-8 w-full">PK</Button>
                </div>
                <div className="w-16 space-y-1">
                  <Label className="text-xs">Nullable</Label>
                  <Button variant={!col.nullable ? "default" : "outline"} size="sm" onClick={() => updateColumn(i, "nullable", !col.nullable)} disabled={col.primaryKey} className="h-8 w-full">NN</Button>
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-xs">Default</Label>
                  <Input value={col.defaultValue} onChange={e => updateColumn(i, "defaultValue", e.target.value)} placeholder="null" className="h-8 text-sm" />
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeColumn(i)} className="h-8 w-8 mt-5"><X className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="bg-muted p-3 rounded-lg">
            <Label className="text-xs text-muted-foreground">Preview:</Label>
            <pre className="text-xs mt-1 overflow-x-auto">{buildCreateSQL()}</pre>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating || !tableName.trim()}>
            {creating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : "Create Table"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
