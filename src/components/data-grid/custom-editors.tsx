"use client";
import {
  GridCellKind,
  type CustomCell,
  type CustomRenderer,
  type ProvideEditorComponent,
  drawTextCell,
} from "@glideapps/glide-data-grid";

export interface TypedCellData {
  readonly display: string;      // what to draw
  readonly dataType: string;     // e.g. "text", "date", "timestamp", enum name
  readonly enumValues?: string[]; // for enums
}

export type TypedCell = CustomCell<TypedCellData>;

const editorFor: ProvideEditorComponent<TypedCell> = ({ value, onChange, onFinishedEditing }) => {
  const d = value.data;
  const isEnum = !!d.enumValues;

  const commit = (v: string) => {
    // Don't stage a no-op edit (same value).
    if (v === d.display) {
      onFinishedEditing();
      return;
    }
    const cell: TypedCell = { ...value, data: { ...d, display: v } };
    onChange(cell);
    onFinishedEditing(cell);
  };

  if (isEnum) {
    return (
      <div style={{ display: "flex", flexDirection: "column", padding: 8, gap: 4 }}>
        <select
          autoFocus
          defaultValue={d.display}
          onChange={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") onFinishedEditing(); }}
          style={{ fontSize: 14, padding: "4px 6px", width: "100%" }}
        >
          <option value="">NULL</option>
          {(d.enumValues ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  const isDate = /date|timestamp|time/.test(d.dataType.toLowerCase());
  const inputType = isDate && d.dataType.toLowerCase().includes("date")
    ? "date"
    : isDate ? "datetime-local" : "text";

  return (
    <div style={{ padding: 8 }}>
      <input
        autoFocus
        type={inputType}
        defaultValue={d.display}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          if (e.key === "Escape") onFinishedEditing();
        }}
        style={{ fontSize: 14, padding: "4px 6px", width: "100%" }}
      />
    </div>
  );
};

/** Custom renderer that draws the typed cell's text and supplies a type-appropriate editor. */
export const typedCellRenderer: CustomRenderer<TypedCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell): cell is TypedCell => {
    const d = (cell as TypedCell).data;
    return !!d && typeof (d as TypedCellData).display === "string" && typeof (d as TypedCellData).dataType === "string";
  },
  draw: (args, cell) => {
    drawTextCell(args, cell.data.display);
  },
  provideEditor: () => editorFor,
  needsHover: false,
  measure: (_ctx, cell) => cell.data.display.length * 9 + 24,
};
