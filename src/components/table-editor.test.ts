import { describe, it, expect } from "vitest";
import { buildTableSql } from "./table-editor";

function col(name: string, type: string, over: Partial<{ nullable: boolean; primaryKey: boolean; autoIncrement: boolean; unique: boolean; defaultValue: string; id: string }> = {}) {
  return {
    id: over.id ?? `c-${name}`,
    name,
    type,
    nullable: over.nullable ?? true,
    defaultValue: over.defaultValue ?? "",
    primaryKey: over.primaryKey ?? false,
    autoIncrement: over.autoIncrement ?? false,
    unique: over.unique ?? false,
  };
}

function fk(over: Partial<{ column: string; refSchema: string; refTable: string; refColumn: string; onDelete: string; onUpdate: string; id: string }> = {}) {
  return {
    id: over.id ?? "fk-1",
    column: over.column ?? "user_id",
    refSchema: over.refSchema ?? "public",
    refTable: over.refTable ?? "users",
    refColumn: over.refColumn ?? "id",
    onDelete: over.onDelete ?? "CASCADE",
    onUpdate: over.onUpdate ?? "NO ACTION",
  };
}

describe("buildTableSql", () => {
  it("emits a plain CREATE TABLE for columns only", () => {
    const sql = buildTableSql("public", "orders", [
      col("id", "BIGINT", { primaryKey: true, autoIncrement: true, nullable: false }),
      col("note", "TEXT"),
    ], []);
    expect(sql).toContain('CREATE TABLE "public"."orders"');
    expect(sql).toContain('"id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY');
    expect(sql).toContain('"note" TEXT');
  });

  it("appends FOREIGN KEY constraints from FK drafts", () => {
    const sql = buildTableSql("public", "orders", [
      col("id", "BIGINT", { primaryKey: true }),
      col("user_id", "BIGINT"),
    ], [
      fk({ column: "user_id", refTable: "users", refColumn: "id", onDelete: "CASCADE" }),
    ]);
    expect(sql).toContain('FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION');
  });

  it("supports multiple foreign keys", () => {
    const sql = buildTableSql("public", "orders", [
      col("id", "BIGINT", { primaryKey: true }),
      col("user_id", "BIGINT"),
      col("product_id", "BIGINT"),
    ], [
      fk({ column: "user_id", refTable: "users", refColumn: "id" }),
      fk({ column: "product_id", refTable: "products", refColumn: "id", onDelete: "SET NULL", onUpdate: "CASCADE" }),
    ]);
    expect(sql).toContain('FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")');
    expect(sql).toContain('FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL ON UPDATE CASCADE');
  });

  it("skips incomplete FK drafts (missing column/ref)", () => {
    const sql = buildTableSql("public", "orders", [
      col("id", "BIGINT", { primaryKey: true }),
    ], [
      fk({ column: "", refTable: "users" }),
      fk({ column: "user_id", refTable: "", refColumn: "id" }),
    ]);
    expect(sql).not.toContain("FOREIGN KEY");
  });
});
