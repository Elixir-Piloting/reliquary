"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Loader2, Save, ArrowLeft, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { ColumnInfo } from "@/lib/db/types";
import { cn } from "@/lib/utils";

const COLUMN_TYPES = ["VARCHAR", "TEXT", "INTEGER", "BIGINT", "SMALLINT", "DECIMAL", "NUMERIC", "REAL", "DOUBLE PRECISION", "BOOLEAN", "DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "UUID", "JSON", "JSONB"];

interface NewColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string;
  primaryKey: boolean;
}

interface TableEditorProps {
  mode: "create" | "edit";
  schema: string;
  table?: string;
  connectionId: string;
  onCreated?: (schema: string, table: string) => void;
  onDone?: () => void;
}

export function TableEditor({ mode, schema, table, connectionId, onCreated, onDone }: TableEditorProps) {
  const isCreate = mode === "create";
  const [tableName, setTableName] = useState(isCreate ? "" : table || "");
  const [columns, setColumns] = useState<NewColumn[]>(isCreate
    ? [{ name: "id", type: "BIGINT", nullable: false, defaultValue: "", primaryKey: true }]
    : []);
  const [existingCols, setExistingCols] = useState<ColumnInfo[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  // Inline-edit state for existing columns
  const [editing, setEditing] = useState<{ col: string; field: "name" | "default" } | null>(null);
  const [draft, setDraft] = useState("");

  const reload = useCallback(async () => {
    if (!table) return;
    try {
      const cols = await invoke<ColumnInfo[]>("get_columns", { connectionId, schema, table });
      setExistingCols(cols);
    } catch (e: any) {
      toast.error("Failed to load columns", { description: String(e) });
    }
  }, [connectionId, schema, table]);

  useEffect(() => {
    if (isCreate || !table) return;
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [isCreate, table, schema, connectionId, reload]);

  const addColumn = () => setColumns(prev => [...prev, { name: "", type: "TEXT", nullable: true, defaultValue: "", primaryKey: false }]);
  const removeColumn = (i: number) => setColumns(prev => prev.filter((_, idx) => idx !== i));
  const updateColumn = (i: number, field: keyof NewColumn, value: any) =>
    setColumns(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c));

  const buildCreateSQL = useCallback((): string => {
    const cols = columns.map(c => {
      let def = `"${c.name}" ${c.type}`;
      if (c.primaryKey) def += " PRIMARY KEY";
      if (!c.nullable && !c.primaryKey) def += " NOT NULL";
      if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
      return def;
    });
    return `CREATE TABLE "${schema}"."${tableName}" (\n  ${cols.join(",\n  ")}\n);`;
  }, [columns, schema, tableName]);

  const handleCreate = async () => {
    if (!tableName.trim()) { toast.error("Table name is required"); return; }
    if (columns.some(c => !c.name.trim())) { toast.error("All columns need a name"); return; }
    setSaving(true);
    try {
      await invoke("execute_query", { connectionId, query: buildCreateSQL() });
      toast.success(`Table "${tableName}" created`);
      onCreated?.(schema, tableName);
    } catch (e: any) {
      toast.error("Failed to create table", { description: String(e) });
    }
    setSaving(false);
  };

  const runAlter = async (sql: string, okMsg: string) => {
    setSaving(true);
    try {
      await invoke("execute_query", { connectionId, query: sql });
      toast.success(okMsg);
      await reload();
    } catch (e: any) {
      toast.error("Alter failed", { description: String(e) });
    }
    setSaving(false);
  };

  const handleAddColumn = async (col: NewColumn) => {
    if (!table || !col.name.trim()) { toast.error("Column name is required"); return; }
    let def = `"${col.name}" ${col.type}`;
    if (!col.nullable) def += " NOT NULL";
    if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
    await runAlter(`ALTER TABLE "${schema}"."${table}" ADD COLUMN ${def};`, `Column "${col.name}" added`);
    setColumns(prev => prev.filter((_, idx) => idx !== columns.findIndex(c => c === col)));
  };

  const commitRename = async (oldName: string) => {
    if (!table || !draft.trim() || draft === oldName) { setEditing(null); return; }
    await runAlter(`ALTER TABLE "${schema}"."${table}" RENAME COLUMN "${oldName}" TO "${draft}";`, `Renamed "${oldName}" → "${draft}"`);
    setEditing(null);
  };

  const commitDefault = async (colName: string, oldDefault: string | null) => {
    if (!table) { setEditing(null); return; }
    if (draft === (oldDefault || "")) { setEditing(null); return; }
    const sql = draft.trim() === ""
      ? `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${colName}" DROP DEFAULT;`
      : `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${colName}" SET DEFAULT ${draft};`;
    await runAlter(sql, `Default updated for "${colName}"`);
    setEditing(null);
  };

  const changeType = async (colName: string, newType: string) => {
    if (!table) return;
    await runAlter(`ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${colName}" TYPE ${newType} USING "${colName}"::${newType};`, `Type changed to ${newType}`);
  };

  const toggleNullable = async (col: ColumnInfo) => {
    if (!table) return;
    const sql = col.isNullable
      ? `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${col.columnName}" SET NOT NULL;`
      : `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${col.columnName}" DROP NOT NULL;`;
    await runAlter(sql, `"${col.columnName}" ${col.isNullable ? "set NOT NULL" : "nullable"}`);
  };

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="flex flex-col h-full">
      <div className="h-auto min-h-12 border-b border-border flex items-center gap-3 px-6 py-2 shrink-0 bg-muted/20">
        <Button variant="ghost" size="sm" onClick={onDone}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <h2 className="text-sm font-semibold">
          {isCreate ? `New Table in "${schema}"` : `Edit ${schema}.${table}`}
        </h2>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex-1 overflow-auto px-6 pb-6 pt-4">
        <div className="space-y-6">
          {isCreate && (
            <div className="space-y-2">
              <Label>Table Name</Label>
              <Input value={tableName} onChange={e => setTableName(e.target.value)} placeholder="table_name" className="max-w-md" />
            </div>
          )}

          {!isCreate && existingCols.length > 0 && (
            <div className="space-y-3">
              <Label>Columns ({existingCols.length})</Label>
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/40 text-xs font-medium text-muted-foreground border-b border-border">
                  <div className="col-span-3">Name</div>
                  <div className="col-span-3">Type</div>
                  <div className="col-span-2">Nullable</div>
                  <div className="col-span-1">PK</div>
                  <div className="col-span-2">Default</div>
                  <div className="col-span-1" />
                </div>
                {existingCols.map(c => {
                  const isEditingName = editing?.col === c.columnName && editing.field === "name";
                  const isEditingDefault = editing?.col === c.columnName && editing.field === "default";
                  return (
                    <div key={c.columnName} className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-border last:border-b-0 text-sm items-center">
                      <div className="col-span-3 font-mono">
                        {isEditingName ? (
                          <Input value={draft} onChange={e => setDraft(e.target.value)} autoFocus
                            onBlur={() => commitRename(c.columnName)}
                            onKeyDown={e => { if (e.key === 'Enter') commitRename(c.columnName); if (e.key === 'Escape') setEditing(null); }}
                            className="h-7 text-xs font-mono" />
                        ) : (
                          <button onClick={() => { setEditing({ col: c.columnName, field: "name" }); setDraft(c.columnName); }} className="text-left hover:text-blue-500 hover:underline cursor-pointer">
                            {c.columnName}
                          </button>
                        )}
                      </div>
                      <div className="col-span-3">
                        <Select value={c.dataType.toUpperCase()} onValueChange={v => changeType(c.columnName, v)} disabled={c.isPrimaryKey}>
                          <SelectTrigger className="h-7 text-xs font-mono"><SelectValue /></SelectTrigger>
                          <SelectContent>{COLUMN_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Button variant={c.isNullable ? "outline" : "default"} size="sm" onClick={() => toggleNullable(c)} disabled={c.isPrimaryKey} className="h-7 text-xs">
                          {c.isNullable ? "NULL" : "NOT NULL"}
                        </Button>
                      </div>
                      <div className="col-span-1">{c.isPrimaryKey && <span className="text-amber-500 font-medium text-xs">PK</span>}</div>
                      <div className="col-span-2 font-mono text-xs text-muted-foreground">
                        {isEditingDefault ? (
                          <Input value={draft} onChange={e => setDraft(e.target.value)} autoFocus
                            onBlur={() => commitDefault(c.columnName, c.defaultValue)}
                            onKeyDown={e => { if (e.key === 'Enter') commitDefault(c.columnName, c.defaultValue); if (e.key === 'Escape') setEditing(null); }}
                            placeholder="none" className="h-7 text-xs font-mono" />
                        ) : (
                          <button onClick={() => { setEditing({ col: c.columnName, field: "default" }); setDraft(c.defaultValue || ""); }} className="text-left hover:text-blue-500 hover:underline cursor-pointer truncate w-full">
                            {c.defaultValue || "—"}
                          </button>
                        )}
                      </div>
                      <div className="col-span-1" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{isCreate ? "Columns" : "Add New Columns"}</Label>
              <Button variant="outline" size="sm" onClick={addColumn}><Plus className="h-4 w-4 mr-1" />Add Column</Button>
            </div>
            {columns.map((col, i) => (
              <div key={i} className="flex items-start gap-2 p-3 border border-border rounded-lg bg-muted/10">
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
                {isCreate && (
                  <div className="w-16 space-y-1">
                    <Label className="text-xs">PK</Label>
                    <Button variant={col.primaryKey ? "default" : "outline"} size="sm" onClick={() => updateColumn(i, "primaryKey", !col.primaryKey)} className="h-8 w-full">PK</Button>
                  </div>
                )}
                <div className="w-16 space-y-1">
                  <Label className="text-xs">Null</Label>
                  <Button variant={!col.nullable ? "default" : "outline"} size="sm" onClick={() => updateColumn(i, "nullable", !col.nullable)} disabled={isCreate && col.primaryKey} className="h-8 w-full">NN</Button>
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-xs">Default</Label>
                  <Input value={col.defaultValue} onChange={e => updateColumn(i, "defaultValue", e.target.value)} placeholder="none" className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1 pt-5">
                  {!isCreate && (
                    <Button size="sm" onClick={() => handleAddColumn(col)} disabled={saving || !col.name.trim()} className="h-8" title="Add this column">
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => removeColumn(i)} className="h-8 w-8"><X className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            {columns.length === 0 && !isCreate && (
              <p className="text-sm text-muted-foreground text-center py-4">No new columns queued. Click "Add Column" to add one, or edit existing columns above.</p>
            )}
          </div>

          {isCreate && (
            <div className="bg-muted p-3 rounded-lg">
              <Label className="text-xs text-muted-foreground">Preview:</Label>
              <pre className="text-xs mt-1 overflow-x-auto font-mono">{buildCreateSQL()}</pre>
            </div>
          )}
        </div>
      </div>
      {isCreate && (
        <div className="shrink-0 border-t border-border bg-card/80 backdrop-blur-sm px-6 py-3 flex justify-end gap-2">
          <Button variant="outline" onClick={onDone}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || !tableName.trim()}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : <><Save className="h-4 w-4 mr-2" />Create Table</>}
          </Button>
        </div>
      )}
    </div>
  );
}
