"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, KeyRound } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getInputType, isPotentialEnum, toSqlParamValue } from "./field-types";
import type { RowMutationStatement } from "@/lib/db/types";

export interface InsertColumn {
  name: string;
  dataType: string;
}

interface InsertRowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  schema: string;
  table: string;
  columns: InsertColumn[];
  pkColumns: string[];
  onSubmit: (statement: RowMutationStatement, values: Record<string, unknown>) => void;
}

function FieldControl({ column, value, enumValues, onValue }: {
  column: InsertColumn;
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
        <SelectTrigger className="h-8"><SelectValue placeholder="NULL" /></SelectTrigger>
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
        <SelectTrigger className="h-8"><SelectValue placeholder="NULL" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">NULL</SelectItem>
          {enumValues!.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  const type = inputType === 'date' ? 'date' : inputType === 'datetime-local' ? 'datetime-local' : 'text';
  return (
    <Input value={value} onChange={e => onValue(e.target.value)} placeholder="NULL" className="h-8 font-mono text-xs" type={type} />
  );
}

export function InsertRowDialog({ open, onOpenChange, connectionId, schema, table, columns, pkColumns, onSubmit }: InsertRowDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [enumValues, setEnumValues] = useState<Record<string, string[] | null>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues({});
    setSubmitting(false);
    const fetchEnums = async () => {
      const next: Record<string, string[] | null> = {};
      for (const col of columns) {
        if (isPotentialEnum(col.dataType)) {
          try {
            next[col.name] = (await invoke<string[]>("get_enum_values", { connectionId, typeName: col.dataType })) || null;
          } catch {
            next[col.name] = null;
          }
        }
      }
      setEnumValues(next);
    };
    fetchEnums();
  }, [open, columns, connectionId]);

  const setValue = (col: string, v: string) => setValues(prev => ({ ...prev, [col]: v }));

  const handleSubmit = () => {
    const filled = columns.filter(col => (values[col.name] ?? '') !== '');
    let query: string;
    let params: unknown[];
    const typedValues: Record<string, unknown> = {};
    if (filled.length === 0) {
      query = `INSERT INTO "${schema}"."${table}" DEFAULT VALUES`;
      params = [];
    } else {
      const cols = filled.map(c => `"${c.name}"`).join(", ");
      const placeholders = filled.map((_, i) => `$${i + 1}`).join(", ");
      query = `INSERT INTO "${schema}"."${table}" (${cols}) VALUES (${placeholders})`;
      params = filled.map(c => toSqlParamValue(values[c.name] ?? '', c.dataType));
    }
    for (const c of filled) typedValues[c.name] = toSqlParamValue(values[c.name] ?? '', c.dataType);
    setSubmitting(true);
    try {
      onSubmit({ query, params }, typedValues);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="h-4 w-4" />Insert Row</DialogTitle>
          <DialogDescription>
            New row in <span className="font-mono text-xs">{schema}.{table}</span> — blank fields are omitted so database defaults apply.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto pr-1 -mx-6 px-6">
          <div className="space-y-3 py-2">
            {columns.map(col => (
              <div key={col.name} className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <span className="font-mono">{col.name}</span>
                  <span className="text-muted-foreground font-normal">{col.dataType}</span>
                  {pkColumns.includes(col.name) && <KeyRound className="h-3 w-3 text-amber-500" />}
                </Label>
                <FieldControl
                  column={col}
                  value={values[col.name] ?? ''}
                  enumValues={enumValues[col.name] ?? null}
                  onValue={v => setValue(col.name, v)}
                />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Insert Row
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
