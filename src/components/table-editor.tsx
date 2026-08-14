"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Loader2, Save, ArrowLeft, Check, KeyRound, GripVertical } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { ColumnInfo, TableInfo } from "@/lib/db/types";
import { useRightSidebar } from "@/components/right-sidebar-context";
import { CreateTableSqlPanel } from "@/components/create-table-sql-panel";

const COLUMN_TYPES = ["VARCHAR", "TEXT", "INTEGER", "BIGINT", "SMALLINT", "DECIMAL", "NUMERIC", "REAL", "DOUBLE PRECISION", "BOOLEAN", "DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "UUID", "JSON", "JSONB"];

const FK_ACTIONS = ["NO ACTION", "CASCADE", "SET NULL", "RESTRICT"] as const;

/** Shared grid template for the column header + rows (7 cells). The first
 *  column is an empty gutter reserved for the drag-and-drop handle. */
const COL_GRID = "grid-cols-[2rem_3rem_minmax(8rem,1fr)_8rem_7rem_minmax(10rem,1fr)_2.5rem]";

/** Shared grid template for the foreign-key header + rows (6 cells). */
const FK_GRID = "grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_8rem_8rem_2.5rem]";

/** Vertical divider on every cell except the first column. */
const cellClass = "border-l border-border/60 first:border-l-0";

interface NewColumn {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string;
  primaryKey: boolean;
  autoIncrement: boolean;
  unique: boolean;
}

interface ForeignKeyDraft {
  id: string;
  column: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
  onDelete: string;
  onUpdate: string;
}

let idCounter = 0;
const nextId = () => `col-${Date.now()}-${idCounter++}`;

const emptyColumn = (): NewColumn => ({ id: nextId(), name: "", type: "TEXT", nullable: true, defaultValue: "", primaryKey: false, autoIncrement: false, unique: false });

const emptyFk = (schema: string): ForeignKeyDraft => ({ id: nextId(), column: "", refSchema: schema, refTable: "", refColumn: "", onDelete: "NO ACTION", onUpdate: "NO ACTION" });

/** A default-value input that adapts to the column type. */
function DefaultValueControl({ type, value, nullable, onChange }: { type: string; value: string; nullable: boolean; onChange: (v: string) => void }) {
  const t = type.toUpperCase();
  if (t === "BOOLEAN" || t === "BOOL") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="NULL" /></SelectTrigger>
        <SelectContent>
          {nullable && <SelectItem value="">NULL</SelectItem>}
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (t === "DATE") return <Input type="date" value={value} onChange={e => onChange(e.target.value)} className="h-8 text-sm" />;
  if (t === "TIME") return <Input type="time" value={value} onChange={e => onChange(e.target.value)} className="h-8 text-sm" />;
  if (t === "TIMESTAMP" || t === "TIMESTAMPTZ") return <Input type="datetime-local" value={value} onChange={e => onChange(e.target.value)} className="h-8 text-sm" />;
  if (/INT|SERIAL|NUMERIC|DECIMAL|REAL|DOUBLE|SMALLINT|BIGINT|FLOAT/.test(t)) return <Input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder="none" className="h-8 text-sm" />;
  return <Input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="none" className="h-8 text-sm" />;
}

interface ColumnRowProps {
  col: NewColumn;
  index: number;
  total: number;
  isCreate: boolean;
  saving: boolean;
  onUpdate: (i: number, field: keyof NewColumn, value: any) => void;
  onRemove: (i: number) => void;
  onAddColumn: (col: NewColumn) => void;
}

/** A sortable column row using @dnd-kit; reordering animates via its built-in
 *  sortable transitions. Drag the grip handle to reorder. */
function ColumnRow({ col, index, total, isCreate, saving, onUpdate, onRemove, onAddColumn }: ColumnRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={COL_GRID + " grid items-center gap-2 py-1 text-sm"}>
      {/* Drag handle gutter */}
      <div className={cellClass + " flex items-center justify-center"}>
        <button {...attributes} {...listeners} className="p-0.5 rounded hover:bg-accent text-muted-foreground cursor-grab active:cursor-grabbing" title="Drag to reorder">
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className={cellClass + " flex items-center justify-center"}>
        <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
      </div>
      <div className={cellClass}>
        <Input value={col.name} onChange={e => onUpdate(index, "name", e.target.value)} placeholder="column_name" className="h-8 text-sm" />
      </div>
      <div className={cellClass}>
        <Select value={col.type} onValueChange={v => onUpdate(index, "type", v)}>
          <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
          <SelectContent>{COLUMN_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className={cellClass}>
        <DefaultValueControl type={col.type} value={col.defaultValue} nullable={col.nullable} onChange={v => onUpdate(index, "defaultValue", v)} />
      </div>
      <div className={cellClass + " flex items-center gap-3"}>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Primary key">
          <Checkbox checked={col.primaryKey} onCheckedChange={(v) => { onUpdate(index, "primaryKey", !!v); if (v) onUpdate(index, "nullable", false); }} />PK
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Auto increment">
          <Checkbox checked={col.autoIncrement} onCheckedChange={(v) => onUpdate(index, "autoIncrement", !!v)} />AI
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Unique">
          <Checkbox checked={col.unique} onCheckedChange={(v) => onUpdate(index, "unique", !!v)} />UQ
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Nullable">
          <Checkbox checked={col.nullable} onCheckedChange={(v) => onUpdate(index, "nullable", !!v)} disabled={col.primaryKey} />Null
        </label>
      </div>
      <div className={cellClass + " flex items-center justify-end gap-1"}>
        {!isCreate && (
          <Button size="sm" onClick={() => onAddColumn(col)} disabled={saving || !col.name.trim()} className="h-7" title="Add this column">
            <Check className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={() => onRemove(index)} className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Remove column"><X className="h-4 w-4" /></Button>
      </div>
    </div>
  );
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
    ? [{ ...emptyColumn(), name: "id", type: "BIGINT", nullable: false, primaryKey: true, autoIncrement: true }]
    : []);
  const [existingCols, setExistingCols] = useState<ColumnInfo[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  // Inline-edit state for existing columns
  const [editing, setEditing] = useState<{ col: string; field: "name" | "default" } | null>(null);
  const [draft, setDraft] = useState("");

  // Foreign keys (UI only for now). Each FK is an editable inline row.
  const [fkDrafts, setFkDrafts] = useState<ForeignKeyDraft[]>([]);
  const [refTables, setRefTables] = useState<TableInfo[]>([]);
  const [refColumnsByTable, setRefColumnsByTable] = useState<Record<string, ColumnInfo[]>>({});

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

  const addColumn = () => setColumns(prev => [...prev, emptyColumn()]);
  const removeColumn = (i: number) => setColumns(prev => prev.filter((_, idx) => idx !== i));
  const updateColumn = (i: number, field: keyof NewColumn, value: any) =>
    setColumns(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c));

  /** Load (and cache) the columns of a reference table for the FK dropdowns. */
  const loadRefColumns = useCallback(async (tableName: string) => {
    if (!tableName || refColumnsByTable[tableName]) return;
    try {
      const cs = await invoke<ColumnInfo[]>("get_columns", { connectionId, schema, table: tableName });
      setRefColumnsByTable(prev => ({ ...prev, [tableName]: cs || [] }));
    } catch {
      setRefColumnsByTable(prev => ({ ...prev, [tableName]: [] }));
    }
  }, [connectionId, schema, refColumnsByTable]);

  const updateFk = (i: number, field: keyof ForeignKeyDraft, value: string) =>
    setFkDrafts(prev => prev.map((fk, idx) => idx === i ? { ...fk, [field]: value } : fk));

  const addFk = () => setFkDrafts(prev => [...prev, emptyFk(schema)]);

  const removeFk = (i: number) => setFkDrafts(prev => prev.filter((_, idx) => idx !== i));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (event: { active: any; over: any }) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = columns.findIndex(c => c.id === active.id);
    const newIndex = columns.findIndex(c => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setColumns(prev => arrayMove(prev, oldIndex, newIndex));
  };

  const buildCreateSQL = useCallback((): string => {
    const cols = columns.map(c => {
      let def = `"${c.name}" ${c.type}`;
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

          {/* Column editor — header row + rows (no wrapper, vertical dividers only) */}
          <div className="space-y-2">
            <Label>{isCreate ? "Columns" : "Add New Columns"}</Label>
            <div className={COL_GRID + " grid items-center gap-2 text-xs font-medium text-muted-foreground border-b border-border/70 pb-1.5"}>
              <div className={cellClass} />
              <div className={cellClass + " flex items-center justify-center"}>#</div>
              <div className={cellClass}>Name</div>
              <div className={cellClass}>Type</div>
              <div className={cellClass}>Default</div>
              <div className={cellClass}>Constraints</div>
              <div className={cellClass} />
            </div>
            {columns.length > 0 && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={columns.map(c => c.id)} strategy={verticalListSortingStrategy}>
                  {columns.map((col, i) => (
                    <ColumnRow
                      key={col.id}
                      col={col}
                      index={i}
                      total={columns.length}
                      isCreate={isCreate}
                      saving={saving}
                      onUpdate={updateColumn}
                      onRemove={removeColumn}
                      onAddColumn={handleAddColumn}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
            {columns.length === 0 && !isCreate && (
              <p className="text-sm text-muted-foreground text-center py-2">No new columns queued. Add one below.</p>
            )}
            <Button variant="outline" size="sm" onClick={addColumn}><Plus className="h-4 w-4 mr-1" />Add Column</Button>
          </div>

          {/* Foreign keys — UI only for now */}
          {isCreate && (
            <div className="space-y-2">
              <Label>Foreign Keys</Label>
              <div className={FK_GRID + " grid items-center gap-2 text-xs font-medium text-muted-foreground border-b border-border/70 pb-1.5"}>
                <div className={cellClass}>Column</div>
                <div className={cellClass}>Reference Table</div>
                <div className={cellClass}>Reference Column</div>
                <div className={cellClass}>On Delete</div>
                <div className={cellClass}>On Update</div>
                <div className={cellClass} />
              </div>
              {fkDrafts.map((fk, i) => (
                <div key={fk.id} className={FK_GRID + " grid items-center gap-2 py-1 text-sm"}>
                  <div className={cellClass}>
                    <Select value={fk.column} onValueChange={v => updateFk(i, "column", v)}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Column" /></SelectTrigger>
                      <SelectContent>
                        {columns.filter(c => c.name.trim()).map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className={cellClass}>
                    <Select value={fk.refTable} onValueChange={v => { updateFk(i, "refTable", v); updateFk(i, "refColumn", ""); loadRefColumns(v); }}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Ref table" /></SelectTrigger>
                      <SelectContent>
                        {refTables.map(t => <SelectItem key={t.tableName} value={t.tableName}>{t.tableName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className={cellClass}>
                    <Select value={fk.refColumn} onValueChange={v => updateFk(i, "refColumn", v)} disabled={!fk.refTable}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Ref column" /></SelectTrigger>
                      <SelectContent>
                        {(refColumnsByTable[fk.refTable] || []).map(c => <SelectItem key={c.columnName} value={c.columnName}>{c.columnName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className={cellClass}>
                    <Select value={fk.onDelete} onValueChange={v => updateFk(i, "onDelete", v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{FK_ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className={cellClass}>
                    <Select value={fk.onUpdate} onValueChange={v => updateFk(i, "onUpdate", v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{FK_ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className={cellClass + " flex items-center justify-end"}>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => removeFk(i)} title="Remove foreign key"><X className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addFk}><Plus className="h-4 w-4 mr-1" />Add Foreign Key</Button>
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
