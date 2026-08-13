import { describe, it, expect } from "vitest";
import { toCsv, toJson } from "./export";

const simpleResult = {
  columns: [
    { name: "id", dataType: "int4" },
    { name: "name", dataType: "text" },
    { name: "score", dataType: "float8" },
    { name: "note", dataType: "text" },
  ],
  rows: [
    { id: 1, name: "alice", score: 9.5, note: null },
    { id: 2, name: "bob, jr", score: 7, note: 'said "hi"' },
  ],
};

describe("toCsv", () => {
  it("writes a header row from column names", () => {
    const csv = toCsv(simpleResult);
    expect(csv.split("\n")[0]).toBe("id,name,score,note");
  });

  it("renders numbers as their string form", () => {
    const csv = toCsv(simpleResult);
    const row = csv.split("\n")[1];
    expect(row).toBe("1,alice,9.5,");
  });

  it("renders null as an empty field", () => {
    const csv = toCsv(simpleResult);
    expect(csv.split("\n")[1].endsWith(",")).toBe(true);
  });

  it("quotes fields containing commas", () => {
    const csv = toCsv(simpleResult);
    const row = csv.split("\n")[2];
    expect(row).toContain('"bob, jr"');
  });

  it("quotes fields containing double quotes and doubles embedded quotes", () => {
    const csv = toCsv(simpleResult);
    const row = csv.split("\n")[2];
    expect(row).toContain('"said ""hi"""');
  });

  it("quotes fields containing newlines and keeps the newline inside", () => {
    const result = {
      columns: [{ name: "a", dataType: "text" }],
      rows: [{ a: "line1\nline2" }],
    };
    const csv = toCsv(result);
    const lines = csv.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[1]).toBe('"line1');
    expect(lines[2]).toBe('line2"');
  });

  it("renders booleans as true/false strings", () => {
    const result = {
      columns: [{ name: "ok", dataType: "bool" }],
      rows: [{ ok: true }, { ok: false }],
    };
    const csv = toCsv(result);
    expect(csv.split("\n")).toEqual(["ok", "true", "false"]);
  });

  it("renders objects and arrays as JSON strings", () => {
    const result = {
      columns: [{ name: "meta", dataType: "jsonb" }],
      rows: [{ meta: { a: 1 } }, { meta: [1, 2] }],
    };
    const csv = toCsv(result);
    expect(csv.split("\n")[1]).toBe('"{""a"":1}"');
    expect(csv.split("\n")[2]).toBe('"[1,2]"');
  });
});

describe("toJson", () => {
  it("returns a pretty-printed array of row objects", () => {
    const json = toJson(simpleResult);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: 1, name: "alice", score: 9.5, note: null });
    expect(json).toContain("\n    \"id\": 1,");
  });
});
