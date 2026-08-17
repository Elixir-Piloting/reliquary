"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  DataEditor,
  GridColumn,
  GridCellKind,
  type DataEditorRef,
  type GridCell,
  type Item,
  type EditableGridCell,
  type EditListItem,
  type GridSelection,
} from "@glideapps/glide-data-grid";
import { glideTheme } from "./glide-theme";
import { toGridCell } from "./cell-mapping";
import { typedCellRenderer, type TypedCell, type TypedCellData } from "./custom-editors";
import { buildUpdateChange, cellEditToString } from "./editing";
import { isPotentialEnum } from "@/components/results-viewer/field-types";
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
  onOpenRow: (row: Record<string, unknown>) => void;
  /** Staged (uncommitted) edits per row: rowIndex -> { columnName -> canonical string }. */
  stagedByRow?: Map<number, Record<string, string>>;
  stagedPkKeys: Set<string>; // PK keys whose rows have staged changes
  enumValues?: Record<string, string[] | null>;
  hiddenColumns?: Set<string>;
}

export function GlideDataGrid(props: GlideDataGridProps) {
  const {
    rows, columns, schema, table, pkColumns = [], columnsMeta = [],
    canEdit, onStagedChange, onRequestDelete, onOpenRow, stagedPkKeys,
    stagedByRow, enumValues = {}, hiddenColumns,
  } = props;
  const ref = useRef<DataEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dark = isDarkMode();
  const [pendingDelete, setPendingDelete] = useState<GridSelection | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

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
    () => visibleCols.map((c, i) => ({
      title: c.name,
      id: c.name,
      width: colWidths[c.name] ?? Math.max(160, Math.min(c.name.length * 10 + 70, 300)),
      // Let only the last column grow so the grid spans full width without
      // over-stretching every column.
      ...(i === visibleCols.length - 1 ? { grow: 1 } : {}),
    })),
    [visibleCols, colWidths]
  );

  // Persist freeform column resizing.
  const onColumnResize = useCallback((col: GridColumn, newSize: number, colIndex: number) => {
    setColWidths(prev => ({ ...prev, [col.id ?? String(colIndex)]: newSize }));
  }, []);

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const col = visibleCols[cell[0]];
      if (!col) return { kind: GridCellKind.Text, displayData: "", data: "", allowOverlay: false, readonly: true };
      const rowIdx = cell[1];
      const row = rows[rowIdx];
      if (!row) return { kind: GridCellKind.Text, displayData: "", data: "", allowOverlay: false, readonly: true };
      const meta = metaByCol.get(col.name);
      const dataType = meta?.dataType || col.dataType;
      const dt = dataType.toLowerCase();
      // Overlay any staged (uncommitted) edit for this cell so it reflects
      // immediately (booleans, text, etc.) instead of reverting to the DB value.
      const stagedVal = stagedByRow?.get(rowIdx)?.[col.name];
      const isStaged = stagedVal !== undefined;
      const value = isStaged ? stagedVal : row[col.name];

      // Amber highlight for staged (uncommitted) cells.
      const stagedTheme = isStaged
        ? {
            bgCell: dark ? "rgba(245,158,11,0.14)" : "rgba(245,158,11,0.14)",
            textDark: dark ? "#fcd34d" : "#92400e",
            textMedium: dark ? "#fcd34d" : "#92400e",
            textLight: dark ? "#fcd34d" : "#92400e",
          }
        : undefined;

      // Enum / date / time columns use a custom typed cell with a dedicated editor.
      const enumVals = enumValues[dataType] ?? null;
      if (isPotentialEnum(dt) && enumVals && enumVals.length > 0) {
        const cellData: TypedCellData = {
          display: value === null || value === undefined ? "" : String(value),
          dataType,
          enumValues: enumVals,
        };
        return { kind: GridCellKind.Custom, data: cellData, copyData: cellData.display, readonly: !canEdit, allowOverlay: true, themeOverride: stagedTheme };
      }
      if (dt.includes("date") || dt.includes("timestamp") || dt.includes("time")) {
        const cellData: TypedCellData = {
          display: value === null || value === undefined ? "" : String(value),
          dataType,
        };
        return { kind: GridCellKind.Custom, data: cellData, copyData: cellData.display, readonly: !canEdit, allowOverlay: true, themeOverride: stagedTheme };
      }

      const gridCell = toGridCell(value, dataType, { readonly: !canEdit });
      if (isStaged) (gridCell as { themeOverride?: unknown }).themeOverride = stagedTheme;
      return gridCell;
    },
    [visibleCols, rows, metaByCol, canEdit, stagedByRow, enumValues, dark]
  );

  // Single-cell edit (double-click/Enter). Edits are parameterized, never
  // string-built SQL.
  const onCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      if (!canEdit || !schema || !table) return;
      const [cIdx, rIdx] = cell;
      const col = visibleCols[cIdx];
      const row = rows[rIdx];
      if (!col || !row) return;
      const meta = metaByCol.get(col.name);
      const change = buildUpdateChange({
        schema,
        table,
        row,
        columnName: col.name,
        dataType: meta?.dataType || col.dataType,
        pkColumns,
        newValue: cellEditToString(newValue),
      });
      if (change) onStagedChange(change);
    },
    [canEdit, schema, table, visibleCols, rows, metaByCol, pkColumns, onStagedChange]
  );

  // Batch edit callback (e.g. paste) — also supported.
  const onCellsEdited = useCallback(
    (newValues: readonly EditListItem[]) => {
      for (const edit of newValues) onCellEdited(edit.location, edit.value);
    },
    [onCellEdited]
  );

  // Single-click a data cell -> open the row in the inspector for editing there.
  // Editing in the grid still happens via double-click (onCellEdited). Both
  // coexist, matching the original app's behavior.
  const openRow = useCallback(
    (cell: Item) => {
      const [cIdx, rIdx] = cell;
      if (cIdx < 0 || rIdx < 0) return;
      if (cIdx >= visibleCols.length) return;
      const row = rows[rIdx];
      if (row) onOpenRow(row);
    },
    [rows, onOpenRow, visibleCols.length]
  );

  // Deletion is triggered ONLY by an explicit Delete keypress over a selection.
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
    <div ref={containerRef} className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex-1 min-h-0">
        <DataEditor
          ref={ref}
          theme={glideTheme(dark)}
          columns={gridColumns}
          rows={rows.length}
          getCellContent={getCellContent}
          customRenderers={[typedCellRenderer]}
          onCellEdited={onCellEdited}
          onCellsEdited={onCellsEdited}
          onCellClicked={openRow}
          onDelete={handleDeleteRequest}
          onColumnResize={onColumnResize}
          rangeSelect="rect"
          rowSelect="multi"
          columnSelect="none"
          rowSelectionMode="multi"
          rowMarkers={{ kind: canEdit ? "checkbox-visible" : "number", width: 40 }}
          freezeColumns={1}
          smoothScrollX
          smoothScrollY
          rowHeight={34}
          headerHeight={34}
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
