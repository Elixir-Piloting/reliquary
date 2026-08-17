"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  DataEditor,
  GridColumn,
  GridCellKind,
  type DataEditorRef,
  type GridCell,
  type Item,
  type EditListItem,
  type GridSelection,
} from "@glideapps/glide-data-grid";
import { glideTheme } from "./glide-theme";
import { toGridCell } from "./cell-mapping";
import { buildUpdateChange, cellEditToString } from "./editing";
import type { PendingChange } from "@/components/results-viewer/types";
import { isDarkMode } from "./use-dark";
import { ConfirmDialog } from "@/components/results-viewer/confirm-dialog";

interface GlideDataGridProps {
  rows: Record<string, unknown>[];
  columns: { name: string; dataType: string }[];
  schema?: string;
  table?: string;
  connectionId?: string;
  pkColumns?: string[];
  columnsMeta?: { columnName: string; dataType: string; isNullable: boolean; isIdentity?: boolean; defaultValue?: string | null }[];
  canEdit?: boolean;
  onStagedChange: (change: PendingChange) => void;
  onRequestDelete: (changes: PendingChange[]) => void;
  stagedPkKeys: Set<string>; // PK keys whose rows have staged changes
  enumValues?: Record<string, string[] | null>;
  hiddenColumns?: Set<string>;
}

/**
 * Canvas data grid (Glide). Interaction model:
 * - click / drag selects cells (range select); double-click or Enter edits.
 * - the first column is frozen/anchored so it stays visible while scrolling.
 * - column headers drag to resize; double-clicking a header auto-fits (Glide).
 * - row deletion only happens when the user explicitly presses Delete over a
 *   selection, which opens the confirm dialog (never on a mere selection change).
 */
export function GlideDataGrid(props: GlideDataGridProps) {
  const {
    rows, columns, schema, table, pkColumns = [], columnsMeta = [],
    canEdit, onStagedChange, onRequestDelete, stagedPkKeys,
    enumValues = {}, hiddenColumns,
  } = props;
  const ref = useRef<DataEditorRef>(null);
  const dark = isDarkMode();
  const [pendingDelete, setPendingDelete] = useState<GridSelection | null>(null);

  const visibleCols = useMemo(
    () => columns.filter(c => !hiddenColumns || !hiddenColumns.has(c.name)),
    [columns, hiddenColumns]
  );

  const metaByCol = useMemo(() => {
    const m = new Map<string, { columnName: string; dataType: string; isIdentity?: boolean }>();
    for (const cm of columnsMeta) m.set(cm.columnName, cm);
    for (const c of columns) if (!m.has(c.name)) m.set(c.name, { columnName: c.name, dataType: c.dataType });
    return m;
  }, [columnsMeta, columns]);

  const gridColumns = useMemo<GridColumn[]>(
    () => visibleCols.map(c => ({
      title: c.name,
      id: c.name,
      width: Math.max(140, Math.min(c.name.length * 8 + 60, 260)),
    })),
    [visibleCols]
  );

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const col = visibleCols[cell[0]];
      const row = rows[cell[1]];
      if (!col || !row) return { kind: GridCellKind.Text, displayData: "", data: "", allowOverlay: true };
      const meta = metaByCol.get(col.name);
      const value = row[col.name];
      return toGridCell(value, meta?.dataType || col.dataType, { readonly: !canEdit });
    },
    [visibleCols, rows, metaByCol, canEdit]
  );

  const onCellsEdited = useCallback(
    (newValues: readonly EditListItem[]) => {
      if (!canEdit || !schema || !table) return;
      for (const edit of newValues) {
        const [cIdx, rIdx] = edit.location;
        const col = visibleCols[cIdx];
        const row = rows[rIdx];
        if (!col || !row) continue;
        const meta = metaByCol.get(col.name);
        const change = buildUpdateChange({
          schema,
          table,
          row,
          columnName: col.name,
          dataType: meta?.dataType || col.dataType,
          pkColumns,
          newValue: cellEditToString(edit.value),
        });
        if (change) onStagedChange(change);
      }
    },
    [canEdit, schema, table, visibleCols, rows, metaByCol, pkColumns, onStagedChange]
  );

  // Deletion is triggered ONLY by the user pressing Delete over a selection.
  // Store the selection and show the confirm dialog; never fire on selection change.
  const handleDeleteRequest = useCallback((sel: GridSelection) => {
    if (!canEdit || !schema || !table) return true;
    if (sel.rows.length > 0) setPendingDelete(sel);
    return true;
  }, [canEdit, schema, table]);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete || !canEdit || !schema || !table) return;
    const changes: PendingChange[] = [];
    for (const r of pendingDelete.rows.toArray()) {
      const row = rows[r];
      if (!row) continue;
      const pkValues = getPk(row, pkColumns);
      const pkEntries = Object.entries(pkValues);
      if (pkEntries.length === 0) continue;
      const whereClause = pkEntries.map(([k], i) => `"${k}" = $${i + 1}`).join(" AND ");
      changes.push({
        id: `delete-${schema}.${table}-${Date.now()}-${r}`,
        schema,
        table,
        op: "delete",
        columnName: "",
        dataType: "",
        pkValues,
        originalValue: null,
        newValue: null,
        statement: {
          query: `DELETE FROM "${schema}"."${table}" WHERE ${whereClause}`,
          params: pkEntries.map(([, v]) => v),
        },
      });
    }
    setPendingDelete(null);
    if (changes.length > 0) onRequestDelete(changes);
  }, [pendingDelete, canEdit, schema, table, rows, pkColumns, onRequestDelete]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-0">
        <DataEditor
          ref={ref}
          theme={glideTheme(dark)}
          columns={gridColumns}
          rows={rows.length}
          getCellContent={getCellContent}
          onCellsEdited={onCellsEdited}
          onDelete={handleDeleteRequest}
          rangeSelect="rect"
          rowSelect="none"
          columnSelect="none"
          rowMarkers="none"
          freezeColumns={1}
          rowHeight={30}
          headerHeight={32}
          minColumnWidth={100}
          maxColumnWidth={600}
        />
      </div>
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={open => { if (!open) setPendingDelete(null); }}
        title={`Delete ${pendingDelete?.rows.length ?? 0} Row${(pendingDelete?.rows.length ?? 0) !== 1 ? "s" : ""}`}
        description={`This will DELETE ${pendingDelete?.rows.length ?? 0} row${(pendingDelete?.rows.length ?? 0) !== 1 ? "s" : ""} from ${schema}.${table}. Deletion is staged with your other changes and committed atomically via Apply.`}
        confirmLabel="Stage Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function getPk(row: Record<string, unknown>, pkColumns: string[]): Record<string, unknown> {
  const pks: Record<string, unknown> = {};
  for (const pk of pkColumns) if (pk in row) pks[pk] = row[pk];
  return pks;
}
