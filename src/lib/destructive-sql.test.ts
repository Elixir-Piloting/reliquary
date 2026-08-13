import { describe, it, expect } from "vitest";
import { isDestructiveQuery } from "./destructive-sql";

describe("isDestructiveQuery", () => {
  it("detects drop statements", () => {
    expect(isDestructiveQuery("drop table x")).toBe(true);
  });

  it("detects create statements (case-insensitive)", () => {
    expect(isDestructiveQuery("CREATE TABLE t (id int)")).toBe(true);
  });

  it("returns false for read-only queries", () => {
    expect(isDestructiveQuery("select 1")).toBe(false);
  });

  it("skips leading comments", () => {
    expect(isDestructiveQuery("/*c*/delete from t")).toBe(true);
  });

  it("detects a destructive statement after a read-only one", () => {
    expect(isDestructiveQuery("select 1; drop table y")).toBe(true);
  });
});
