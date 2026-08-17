import { describe, it, expect } from "vitest";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { toGridCell, toBoolean } from "../data-grid/cell-mapping";
import {
  buildUpdateChange,
  buildInsertChange,
  buildDeleteChange,
  cellEditToString,
} from "../data-grid/editing";

type AnyCell = { kind: GridCellKind; data: unknown; displayData?: string };

describe("toGridCell (type-safe display)", () => {
  it("renders numeric/decimal (string) without precision loss", () => {
    const cell = toGridCell("12345678901234567890.123456789", "numeric") as AnyCell;
    expect(cell.kind).toBe(GridCellKind.Text);
    expect(cell.data).toBe("12345678901234567890.123456789");
  });

  it("renders JSONB objects as JSON text, not blank", () => {
    const cell = toGridCell({ a: 1, b: [2, 3] }, "jsonb") as AnyCell;
    expect(cell.kind).toBe(GridCellKind.Text);
    expect(cell.data).toBe('{"a":1,"b":[2,3]}');
  });

  it("renders arrays as JSON text, not blank", () => {
    const cell = toGridCell([1, 2, 3], "_int4") as AnyCell;
    expect(cell.kind).toBe(GridCellKind.Text);
    expect(cell.data).toBe("[1,2,3]");
  });

  it("renders bytea hex string", () => {
    const cell = toGridCell("\\x68656c6c6f", "bytea") as AnyCell;
    expect(cell.data).toBe("\\x68656c6c6f");
  });

  it("renders boolean as Glide boolean cell", () => {
    const cell = toGridCell(true, "bool") as AnyCell;
    expect(cell.kind).toBe(GridCellKind.Boolean);
    expect(cell.data).toBe(true);
  });

  it("renders null as empty display", () => {
    const cell = toGridCell(null, "text") as AnyCell;
    expect(cell.kind).toBe(GridCellKind.Text);
    expect(cell.data).toBe("");
  });
});

describe("buildUpdateChange (parameterized edit)", () => {
  const base = {
    schema: "public",
    table: "users",
    row: { id: 5, name: "old" },
    columnName: "name",
    dataType: "text",
    pkColumns: ["id"],
  };

  it("produces a parameterized UPDATE (never string-built SQL)", () => {
    const c = buildUpdateChange({ ...base, newValue: "new" })!;
    expect(c.op).toBe("update");
    expect(c.statement?.query).toBe('UPDATE "public"."users" SET "name" = $1 WHERE "id" = $2');
    expect(c.statement?.params).toEqual(["new", 5]);
  });

  it("returns null when row has no PK", () => {
    expect(buildUpdateChange({ ...base, row: { name: "x" }, newValue: "y" })).toBeNull();
  });

  it("returns null when the new value equals the current value (no-op)", () => {
    expect(buildUpdateChange({ ...base, newValue: "old" })).toBeNull();
  });
});

describe("toBoolean (Postgres bool normalization)", () => {
  it("handles the string 'false' as false (not truthy)", () => {
    expect(toBoolean("false")).toBe(false);
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean("0")).toBe(false);
    expect(toBoolean("")).toBe(false);
    expect(toBoolean(null)).toBe(false);
  });

  it("handles true forms", () => {
    expect(toBoolean("true")).toBe(true);
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean("1")).toBe(true);
    expect(toBoolean("t")).toBe(true);
  });

  it("renders a boolean cell with the correct data value", () => {
    const falseCell = toGridCell("false", "bool") as { data: unknown };
    expect(falseCell.data).toBe(false);
    const trueCell = toGridCell("true", "bool") as { data: unknown };
    expect(trueCell.data).toBe(true);
  });
});

describe("buildInsertChange (parameterized insert, identity excluded)", () => {
  it("excludes identity columns from the INSERT", () => {
    const c = buildInsertChange({
      schema: "public",
      table: "users",
      values: { id: "99", name: "bob" },
      columns: [
        { columnName: "id", dataType: "bigint", isIdentity: true },
        { columnName: "name", dataType: "text" },
      ],
    });
    expect(c.op).toBe("insert");
    expect(c.statement?.query).toBe('INSERT INTO "public"."users" ("name") VALUES ($1)');
    expect(c.statement?.params).toEqual(["bob"]);
  });
});

describe("buildDeleteChange (parameterized delete by PK)", () => {
  it("builds a DELETE bound by PK", () => {
    const c = buildDeleteChange({ schema: "s", table: "t", row: { id: 7 }, pkColumns: ["id"] })!;
    expect(c.op).toBe("delete");
    expect(c.statement?.query).toBe('DELETE FROM "s"."t" WHERE "id" = $1');
    expect(c.statement?.params).toEqual([7]);
  });

  it("returns null with no PK", () => {
    expect(buildDeleteChange({ schema: "s", table: "t", row: { x: 1 }, pkColumns: ["id"] })).toBeNull();
  });
});

describe("cellEditToString", () => {
  it("converts number, boolean, text cell edits to canonical strings", () => {
    expect(cellEditToString({ kind: GridCellKind.Number, data: 42, displayData: "42", allowOverlay: false })).toBe("42");
    expect(cellEditToString({ kind: GridCellKind.Boolean, data: true, allowOverlay: false })).toBe("true");
    expect(cellEditToString({ kind: GridCellKind.Text, data: "hi", displayData: "hi", allowOverlay: true })).toBe("hi");
  });
});
