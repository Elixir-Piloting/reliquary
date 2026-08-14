"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Loader2, Save, ArrowLeft, Check, ChevronUp, ChevronDown, KeyRound } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { ColumnInfo, TableInfo } from "@/lib/db/types";
import { useRightSidebar } from "@/components/right-sidebar-context";
import { CreateTableSqlPanel } from "@/components/create-table-sql-panel";

const COLUMN_TYPES = ["VARCHAR", "TEXT", "INTEGER", "BIGINT", "SMALLINT", "DECIMAL", "NUMERIC", "REAL", "DOUBLE PRECISION", "BOOLEAN", "DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "UUID", "JSON", "JSONB"];

/** Types that accept a parameter (length / precision) in the DDL. */
const PARAM_TYPES = new Set(["VARCHAR", "CHAR", "DECIMAL", "NUMERIC", "TIMESTAMP", "TIMESTAMPTZ", "TIME"]);

const FK_ACTIONS = ["NO ACTION", "CASCADE", "SET NULL", "RESTRICT"] as const;

interface NewColumn {
  name: string;
  type: string;
  parameter: string;
  nullable: boolean;
  defaultValue: string;
  primaryKey: boolean;
  autoIncrement: boolean;
  unique: boolean;
}

interface ForeignKeyDraft {
  column: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
  onDelete: string;
  onUpdate: string;
}

const emptyColumn = (): NewColumn => ({ name: "", type: "TEXT", parameter: "", nullable: true, defaultValue: "", primaryKey: false, autoIncrement: false, unique: false });

const emptyFk = (schema: string): ForeignKeyDraft => ({ column: "", refSchema: schema, refTable: "", refColumn: "", onDelete: "NO ACTION", onUpdate: "NO ACTION" });

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
    ? [{ name: "id", type: "BIGINT", parameter: "", nullable: false, defaultValue: "", primaryKey: true, autoIncrement: true, unique: false }]
    : []);
  const [existingCols, setExistingCols] = useState<ColumnInfo[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  // Inline-edit state for existing columns
  const [editing, setEditing] = useState<{ col: string; field: "name" | "default" } | null>(null);
  const [draft, setDraft] = useState("");

  // Foreign keys (UI only for now).
  const [fkOpen, setFkOpen] = useState(false);
  const [fkDrafts, setFkDrafts] = useState<ForeignKeyDraft[]>([]);
  const [fkForm, setFkForm] = useState<ForeignKeyDraft>(() => emptyFk(schema));
  const [refTables, setRefTables] = useState<TableInfo[]>([]);
  const [refColumns, setRefColumns] = useState<ColumnInfo[]>([]);

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

  useEffect(() => {
    if (!isCreate) return;
    // Preload existing tables for the FK reference dropdown.
    invoke<TableInfo[]>("get_tables", { connectionId, schema })
      .then(ts => setRefTables(ts || []))
      .catch(() => setRefTables([]));
  }, [isCreate, connectionId, schema]);

  useEffect(() => {
    if (!fkForm.refTable) { setRefColumns([]); return; }
    invoke<ColumnInfo[]>("get_columns", { connectionId, schema: fkForm.refSchema, table: fkForm.refTable })
      .then(cs => { setRefColumns(cs || []); setFkForm(f => ({ ...f, refColumn: cs && cs.length > 0 ? "" : "" })); })
      .catch(() => setRefColumns([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkForm.refTable, fkForm.refSchema, connectionId]);

  const addColumn = () => setColumns(prev => [...prev, emptyColumn()]);
  const removeColumn = (i: number) => setColumns(prev => prev.filter((_, idx) => idx !== i));
  const updateColumn = (i: number, field: keyof NewColumn, value: any) =>
    setColumns(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c));

  const moveColumn = (i: number, dir: -1 | 1) => {
    setColumns(prev => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const buildCreateSQL = useCallback((): string => {
    const cols = columns.map(c => {
      let def = `"${c.name}" ${c.type}`;
      if (PARAM_TYPES.has(c.type.toUpperCase()) && c.parameter.trim()) def += `(${c.parameter.trim()})`;
      if (c.autoIncrement && /INT|SERIAL/i.test(c.type)) def += " GENERATED ALWAYS AS IDENTITY";
      if (c.primaryKey) def += " PRIMARY KEY";
      else if (!c.nullable) def += " NOT NULL";
      if (c.unique && !c.primaryKey) def += " UNIQUE";
      if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
      return def;
    });
    return `CREATE TABLE "${schema}"."${tableName}" (\n  ${cols.join(",\n  ")}\n);`;
  }, [columns, schema, tableName]);

  // In create mode, surface the generated SQL in the right sidebar (context-aware
  // "row inspector" panel) instead of an inline preview.
  const rightSidebar = useRightSidebar();
  const createSql = buildCreateSQL();
  useEffect(() => {
    if (!isCreate) {
      rightSidebar.closeRight();
      return;
    }
    rightSidebar.openRight(
      <CreateTableSqlPanel sql={createSql} schema={schema} table={tableName} onClose={() => rightSidebar.closeRight()} />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate, createSql, schema, tableName]);

  useEffect(() => {
    return () => rightSidebar.closeRight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    if (!tableName.trim()) { toast.error("Table name is required"); return; }
    if (columns.some(c => !c.name.trim())) { toast.error("All columns need a name"); return; }
    setSaving(true);
    try {
      await invoke("execute_query", { connectionId, query: buildCreateSQL(), options: { confirmDestructive: true, readOnly: false } });
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
      await invoke("execute_query", { connectionId, query: sql, options: { confirmDestructive: true, readOnly: false } });
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
    if (PARAM_TYPES.has(col.type.toUpperCase()) && col.parameter.trim()) def += `(${col.parameter.trim()})`;
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

  const addFk = () => {
    const fk = { ...fkForm };
    setFkDrafts(prev => [...prev, fk]);
    setFkForm(emptyFk(schema));
    setFkOpen(false);
  };

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const headerBtn = (isCreate ? (
    <Button onClick={handleCreate} disabled={saving || !tableName.trim()} size="sm">
      {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
      Create Table
    </Button>
  ) : (
    <Button onClick={onDone} size="sm" disabled={saving}>
      {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
      Done
    </Button>
  ));

  return (
    <div className="flex flex-col h-full">
      <div className="h-auto min-h-12 border-b border-border flex items-center gap-3 px-6 py-2 shrink-0 bg-muted/20">
        <Button variant="ghost" size="sm" onClick={onDone}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <h2 className="text-sm font-semibold">
          {isCreate ? `New Table in "${schema}"` : `Edit ${schema}.${table}`}
        </h2>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onDone} disabled={saving}>Cancel</Button>
        {headerBtn}
      </div>
      <div className="flex-1 overflow-auto px-6 pb-6 pt-4">
        <div className="space-y-6 max-w-4xl">
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

          {/* Column editor — header row + rows */}
          <div className="space-y-3">
            <Label>{isCreate ? "Columns" : "Add New Columns"}</Label>
            <div className="border border-border rounded-lg overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-[2.5rem_1fr_9rem_5rem_7rem_1fr] md:grid-cols-[2.5rem_1fr_9rem_6rem_7rem_10rem_1fr] lg:grid-cols-[2.5rem_1fr_9rem_6rem_7rem_12rem_1fr] items-center gap-2 px-3 py-2 bg-muted/40 text-xs font-medium text-muted-foreground border-b border-border">
                <div className="flex items-center justify-center">#</div>
                <div>Name</div>
                <div>Type</div>
                <div>Params</div>
                <div>Default</div>
                <div>Constraints</div>
                <div />
              </div>
              {columns.map((col, i) => {
                const isLast = i === columns.length - 1;
                const isFirst = i === 0;
                const showParam = PARAM_TYPES.has(col.type.toUpperCase());
                return (
                  <div key={i} className="grid grid-cols-[2.5rem_1fr_9rem_5rem_7rem_1fr] md:grid-cols-[2.5rem_1fr_9rem_6rem_7rem_10rem_1fr] lg:grid-cols-[2.5rem_1fr_9rem_6rem_7rem_12rem_1fr] items-center gap-2 px-3 py-2 border-b border-border last:border-b-0 text-sm">
                    {/* # + reorder */}
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      <div className="flex items-center">
                        <button onClick={() => moveColumn(i, -1)} disabled={isFirst} className="p-0.5 rounded hover:bg-accent text-muted-foreground disabled:opacity-30 disabled:pointer-events-none" aria-label="Move up"><ChevronUp className="h-3 w-3" /></button>
                        <button onClick={() => moveColumn(i, 1)} disabled={isLast} className="p-0.5 rounded hover:bg-accent text-muted-foreground disabled:opacity-30 disabled:pointer-events-none" aria-label="Move down"><ChevronDown className="h-3 w-3" /></button>
                      </div>
                    </div>
                    <Input value={col.name} onChange={e => updateColumn(i, "name", e.target.value)} placeholder="column_name" className="h-8 text-sm" />
                    <Select value={col.type} onValueChange={v => updateColumn(i, "type", v)}>
                      <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
                      <SelectContent>{COLUMN_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                    {showParam ? (
                      <Input value={col.parameter} onChange={e => updateColumn(i, "parameter", e.target.value)} placeholder="(255)" className="h-8 text-sm" />
                    ) : <div />}
                    <Input value={col.defaultValue} onChange={e => updateColumn(i, "defaultValue", e.target.value)} placeholder="none" className="h-8 text-sm" />
                    {/* Constraints */}
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Primary key">
                        <Checkbox checked={col.primaryKey} onCheckedChange={(v) => { updateColumn(i, "primaryKey", !!v); if (v) updateColumn(i, "nullable", false); }} />PK
                      </label>
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Auto increment">
                        <Checkbox checked={col.autoIncrement} onCheckedChange={(v) => updateColumn(i, "autoIncrement", !!v)} />AI
                      </label>
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Unique">
                        <Checkbox checked={col.unique} onCheckedChange={(v) => updateColumn(i, "unique", !!v)} />UQ
                      </label>
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Nullable">
                        <Checkbox checked={col.nullable} onCheckedChange={(v) => updateColumn(i, "nullable", !!v)} disabled={col.primaryKey} />Null
                      </label>
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      {!isCreate && (
                        <Button size="sm" onClick={() => handleAddColumn(col)} disabled={saving || !col.name.trim()} className="h-8" title="Add this column">
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => removeColumn(i)} className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Remove column"><X className="h-4 w-4" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
            {columns.length === 0 && !isCreate && (
              <p className="text-sm text-muted-foreground text-center py-4">No new columns queued. Add one below.</p>
            )}
            <Button variant="outline" size="sm" onClick={addColumn}><Plus className="h-4 w-4 mr-1" />Add Column</Button>
          </div>

          {/* Foreign keys — UI only for now */}
          {isCreate && (
            <div className="space-y-3">
              <Label>Foreign Keys</Label>
              {fkDrafts.length > 0 && (
                <div className="space-y-1.5">
                  {fkDrafts.map((fk, i) => (
                    <div key={i} className="flex items-center gap-2 border border-border rounded-md px-3 py-2 text-sm text-muted-foreground">
                      <KeyRound className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span className="font-mono">{fk.column || "?"}</span>
                      <span>→</span>
                      <span className="font-mono">{fk.refTable ? `${fk.refSchema}.${fk.refTable}.${fk.refColumn || "?"}` : "?"}</span>
                      <span className="text-xs">ON DELETE {fk.onDelete} · ON UPDATE {fk.onUpdate}</span>
                      <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={() => setFkDrafts(prev => prev.filter((_, idx) => idx !== i))}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  ))}
                </div>
              )}
              {fkOpen ? (
                <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/10">
                  <div className="flex items-center justify-between">
                    <Label>Add Foreign Key</Label>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFkOpen(false)}><X className="h-4 w-4" /></Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Column</Label>
                      <Select value={fkForm.column} onValueChange={v => setFkForm(f => ({ ...f, column: v }))}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Select column" /></SelectTrigger>
                        <SelectContent>
                          {columns.filter(c => c.name.trim()).map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Reference table</Label>
                      <Select value={fkForm.refTable} onValueChange={v => setFkForm(f => ({ ...f, refTable: v }))}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Select table" /></SelectTrigger>
                        <SelectContent>
                          {refTables.map(t => <SelectItem key={t.tableName} value={t.tableName}>{t.tableName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Reference column</Label>
                      <Select value={fkForm.refColumn} onValueChange={v => setFkForm(f => ({ ...f, refColumn: v }))} disabled={!fkForm.refTable}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Select column" /></SelectTrigger>
                        <SelectContent>
                          {refColumns.map(c => <SelectItem key={c.columnName} value={c.columnName}>{c.columnName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">On delete</Label>
                        <Select value={fkForm.onDelete} onValueChange={v => setFkForm(f => ({ ...f, onDelete: v }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{FK_ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">On update</Label>
                        <Select value={fkForm.onUpdate} onValueChange={v => setFkForm(f => ({ ...f, onUpdate: v }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{FK_ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                  <Button size="sm" onClick={addFk} disabled={!fkForm.column || !fkForm.refTable || !fkForm.refColumn}><KeyRound className="h-3.5 w-3.5 mr-1" />Add Foreign Key</Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setFkOpen(true)}><KeyRound className="h-4 w-4 mr-1" />Add Foreign Key</Button>
              )}
            </div>
          )}

          {isCreate && (
            <p className="text-sm text-muted-foreground">SQL preview is shown in the right sidebar (Row Inspector).</p>
          )}
        </div>
      </div>
    </div>
  );
}
