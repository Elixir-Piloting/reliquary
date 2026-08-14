"use client";
import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, KeyRound, ChevronRight, Trash2, RotateCcw, Braces, List } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getInputType, isPotentialEnum, isNumericType, isTextareaType, toSqlParamValue, formatValueForInput, displayValueToString } from "./field-types";
import type { RowMutationStatement } from "@/lib/db/types";
import type { ColumnInfo } from "@/lib/ipc-client";
import { cn } from "@/lib/utils";

export interface RowEditorColumn extends ColumnInfo {
  dataType: string;
}

interface RowEditorPanelProps {
  open: boolean;
  mode: "edit" | "insert";
  connectionId: string;
  schema: string;
  table: string;
  columns: RowEditorColumn[];
  pkColumns: string[];
  row: Record<string, unknown> | null;
  onClose: () => void;
  onStageEdit: (changes: PendingChangeLike[]) => void;
  onStageInsert: (statement: RowMutationStatement, values: Record<string, unknown>) => void;
  onDeleteRow?: (row: Record<string, unknown>) => void;
}

/** The subset of `PendingChange` the panel produces (matches results-viewer/types). */
export interface PendingChangeLike {
  id: string;
  schema: string;
  table: string;
  op: "update";
  columnName: string;
  dataType: string;
  pkValues: Record<string, unknown>;
  originalValue: unknown;
  newValue: string;
}

function FieldControl({ column, value, enumValues, onValue }: {
  column: RowEditorColumn;
  value: string;
  enumValues: string[] | null;
  onValue: (v: string) => void;
}) {
  const inputType = getInputType(column.dataType);
  const isBool = inputType === 'select-boolean';
  const isEnum = inputType === 'maybe-enum' && enumValues && enumValues.length > 0;

  if (isBool) {
    return (
      <Select value={value} onValueChange={onValue}>
        <SelectTrigger className="h-9"><SelectValue placeholder="NULL" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">NULL</SelectItem>
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (isEnum) {
    return (
      <Select value={value} onValueChange={onValue}>
        <SelectTrigger className="h-9"><SelectValue placeholder="NULL" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">NULL</SelectItem>
          {enumValues!.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  const type = inputType === 'date' ? 'date' : inputType === 'datetime-local' ? 'datetime-local' : 'text';
  if (isNumericType(column.dataType)) {
    return (
      <Input value={value} onChange={e => onValue(e.target.value)} placeholder="NULL" className="h-9 font-mono text-xs" type="number" inputMode="decimal" />
    );
  }
  if (isTextareaType(column.dataType)) {
    return (
      <Textarea value={value} onChange={e => onValue(e.target.value)} placeholder="NULL" className="min-h-[120px] font-mono text-xs leading-relaxed" rows={4} />
    );
  }
  return (
    <Input value={value} onChange={e => onValue(e.target.value)} placeholder="NULL" className="h-9 font-mono text-xs" type={type} />
  );
}

export function RowEditorPanel({ open, mode, connectionId, schema, table, columns, pkColumns, row, onClose, onStageEdit, onStageInsert, onDeleteRow }: RowEditorPanelProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [enumValues, setEnumValues] = useState<Record<string, string[] | null>>({});
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [view, setView] = useState<'fields' | 'json'>('fields');
  const [jsonText, setJsonText] = useState('');
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const pkSet = useMemo(() => new Set(pkColumns), [pkColumns]);

  useEffect(() => {
    if (!open) return;
    setValidationError(null);
    setSaving(false);
    setView('fields');
    // Pre-fill from the row being edited; blank for insert.
    const next: Record<string, string> = {};
    for (const col of columns) {
      if (mode === 'edit' && row) {
        next[col.columnName] = formatValueForInput(row[col.columnName] ?? null, getInputType(col.dataType));
      } else {
        next[col.columnName] = '';
      }
    }
    setValues(next);
    setJsonText(JSON.stringify(next, null, 2));
    // Fetch enum labels for maybe-enum columns (per column dataType).
    const fetchEnums = async () => {
      const out: Record<string, string[] | null> = {};
      for (const col of columns) {
        if (isPotentialEnum(col.dataType)) {
          try {
            out[col.columnName] = (await invoke<string[]>("get_enum_values", { connectionId, typeName: col.dataType })) || null;
          } catch {
            out[col.columnName] = null;
          }
        }
      }
      setEnumValues(out);
    };
    fetchEnums();
  }, [open, mode, columns, connectionId, row]);

  if (!open) return null;

  const setValue = (col: string, v: string) => {
    setValues(prev => {
      const next = { ...prev, [col]: v };
      setJsonText(JSON.stringify(next, null, 2));
      return next;
    });
  };

  const switchView = (next: 'fields' | 'json') => {
    if (next === 'json') {
      setJsonText(JSON.stringify(values, null, 2));
    }
    setView(next);
  };

  /** Restore all fields to the actual DB values (discard unsaved edits). */
  const handleRestore = () => {
    if (!row) return;
    const next: Record<string, string> = {};
    for (const col of columns) {
      next[col.columnName] = formatValueForInput(row[col.columnName] ?? null, getInputType(col.dataType));
    }
    setValues(next);
    setJsonText(JSON.stringify(next, null, 2));
    setValidationError(null);
  };

  /** A column is required on insert when it is NOT NULL and has no default. */
  const isRequired = (col: RowEditorColumn) =>
    !col.isNullable && (col.defaultValue === null || col.defaultValue === undefined || col.defaultValue === '');

  /** Whether any value differs from the row's actual DB values (or, for insert, anything is filled). */
  const hasChanges = useMemo(() => {
    if (mode === 'insert') {
      return columns.some(col => (values[col.columnName] ?? '') !== '');
    }
    if (!row) return false;
    return columns.some(col => {
      const current = values[col.columnName] ?? '';
      const original = formatValueForInput(row[col.columnName] ?? null, getInputType(col.dataType));
      return current !== original;
    });
  }, [mode, columns, values, row]);

  const handleSaveEdit = () => {
    if (!row) return;
    const changes: PendingChangeLike[] = [];
    const idBase = `${schema}.${table}-${Date.now()}`;
    for (const col of columns) {
      const raw = values[col.columnName] ?? '';
      const original = formatValueForInput(row[col.columnName] ?? null, getInputType(col.dataType));
      if (raw === original) continue; // unchanged
      changes.push({
        id: `${idBase}-${col.columnName}`,
        schema, table, op: 'update',
        columnName: col.columnName,
        dataType: col.dataType,
        pkValues: (() => {
          const pks: Record<string, unknown> = {};
          for (const pk of pkColumns) if (pk in (row || {})) pks[pk] = row[pk];
          return pks;
        })(),
        originalValue: row[col.columnName],
        newValue: raw,
      });
    }
    if (changes.length === 0) { onClose(); return; }
    setSaving(true);
    onStageEdit(changes);
    setSaving(false);
    onClose();
  };

  const handleSaveFromJson = () => {
    if (!row) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setValidationError('Invalid JSON — fix the syntax before staging.');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setValidationError('JSON must be an object of column → value.');
      return;
    }
    const changes: PendingChangeLike[] = [];
    const idBase = `${schema}.${table}-${Date.now()}`;
    for (const col of columns) {
      if (!(col.columnName in parsed)) continue; // omitted column → unchanged
      const newVal = parsed[col.columnName];
      const original = row[col.columnName];
      const normalized = newVal === null ? '' : typeof newVal === 'string' ? newVal : displayValueToString(newVal);
      const originalStr = formatValueForInput(original ?? null, getInputType(col.dataType));
      if (normalized === originalStr) continue;
      changes.push({
        id: `${idBase}-${col.columnName}`,
        schema, table, op: 'update',
        columnName: col.columnName,
        dataType: col.dataType,
        pkValues: (() => {
          const pks: Record<string, unknown> = {};
          for (const pk of pkColumns) if (pk in (row || {})) pks[pk] = row[pk];
          return pks;
        })(),
        originalValue: original,
        newValue: normalized,
      });
    }
    if (changes.length === 0) { onClose(); return; }
    setSaving(true);
    onStageEdit(changes);
    setSaving(false);
    onClose();
  };

  const handleInsert = () => {
    // NOT NULL columns without a default must be filled.
    const missing = columns.filter(c => isRequired(c) && (values[c.columnName] ?? '').trim() === '');
    if (missing.length > 0) {
      setValidationError(`Missing required value(s): ${missing.map(c => c.columnName).join(', ')}`);
      return;
    }
    const filled = columns.filter(col => (values[col.columnName] ?? '') !== '');
    let query: string;
    let params: unknown[];
    const typedValues: Record<string, unknown> = {};
    if (filled.length === 0) {
      query = `INSERT INTO "${schema}"."${table}" DEFAULT VALUES`;
      params = [];
    } else {
      const cols = filled.map(c => `"${c.columnName}"`).join(", ");
      const placeholders = filled.map((_, i) => `$${i + 1}`).join(", ");
      query = `INSERT INTO "${schema}"."${table}" (${cols}) VALUES (${placeholders})`;
      params = filled.map(c => toSqlParamValue(values[c.columnName] ?? '', c.dataType));
    }
    for (const c of filled) typedValues[c.columnName] = toSqlParamValue(values[c.columnName] ?? '', c.dataType);
    setSaving(true);
    onStageInsert({ query, params }, typedValues);
    setSaving(false);
    onClose();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{mode === 'edit' ? 'Edit Row' : 'Insert Row'}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close editor"><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
        <div className="flex items-center rounded-md border border-border p-0.5">
          <button
            onClick={() => switchView('fields')}
            className={cn("flex h-6 items-center gap-1 rounded px-2 text-xs transition-colors", view === 'fields' ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <List className="h-3 w-3" />Fields
          </button>
          <button
            onClick={() => switchView('json')}
            className={cn("flex h-6 items-center gap-1 rounded px-2 text-xs transition-colors", view === 'json' ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <Braces className="h-3 w-3" />JSON
          </button>
        </div>
        <span className="ml-2 truncate font-mono text-xs text-muted-foreground">{schema}.{table}</span>
      </div>
      {view === 'fields' ? (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-4">
            {columns.map(col => (
              <div key={col.columnName} className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5 text-muted-foreground">
                  <span className="font-mono">{col.columnName}</span>
                  {isRequired(col) && <span className="text-destructive">*</span>}
                  <span className="text-muted-foreground/60 font-normal truncate">{col.dataType}</span>
                  {pkSet.has(col.columnName) && <KeyRound className="h-3 w-3 shrink-0 text-amber-500/70" />}
                </Label>
                <FieldControl
                  column={col}
                  value={values[col.columnName] ?? ''}
                  enumValues={enumValues[col.columnName] ?? null}
                  onValue={v => setValue(col.columnName, v)}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="row-editor-json flex flex-1 flex-col border-t border-border">
          <Editor
            height="100%"
            language="json"
            theme={dark ? "vs-dark" : "vs"}
            value={jsonText}
            onChange={val => setJsonText(val || "")}
            options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: "off", scrollBeyondLastLine: false, wordWrap: "on", automaticLayout: true, tabSize: 2, formatOnPaste: true, overviewRulerLanes: 0, hideCursorInOverviewRuler: true, padding: { top: 8, bottom: 8 }, renderLineHighlight: "none" }}
          />
        </div>
      )}
      {validationError && (
        <div className="border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">{validationError}</div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {mode === 'edit' && row && onDeleteRow && (
            <Button variant="destructive" size="sm" onClick={() => onDeleteRow(row)} disabled={saving}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
            </Button>
          )}
          {mode === 'edit' && row && hasChanges && (
            <Button variant="outline" size="sm" onClick={handleRestore} disabled={saving} title="Discard edits and restore DB values">
              <RotateCcw className="h-3.5 w-3.5 mr-1" />Restore
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {mode === 'edit' ? (
            hasChanges ? (
              <Button size="sm" onClick={view === 'json' ? handleSaveFromJson : handleSaveEdit} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Stage Changes
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            )
          ) : (
            hasChanges ? (
              <Button size="sm" onClick={handleInsert} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Stage Insert
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
