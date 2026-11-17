import { describe, it, expect } from "vitest";
import { displayValueToString, formatValueForInput, isNumericType, isTextareaType, isArrayType, isJsonType, getInputType, arrayToPgLiteral, parsePgArrayLiteral } from "./field-types";

describe("isNumericType", () => {
  it("flags integer, float, numeric, money, serial, real, double, oid", () => {
    for (const t of ["int2", "int4", "int8", "integer", "bigint", "smallint", "serial", "bigserial", "float4", "float8", "real", "double precision", "numeric", "decimal", "money", "oid"]) {
      expect(isNumericType(t)).toBe(true);
    }
  });

  it("does not flag text/json/date/bool", () => {
    for (const t of ["text", "varchar", "jsonb", "date", "bool", "uuid", "character varying"]) {
      expect(isNumericType(t)).toBe(false);
    }
  });
});

describe("isTextareaType", () => {
  it("flags text, varchar, char, json, jsonb, xml, tsvector, uuid, interval, custom types", () => {
    for (const t of ["text", "varchar", "character varying", "bpchar", "name", "json", "jsonb", "xml", "tsvector", "tsquery", "uuid", "inet", "interval", "bytea", "my_custom_type", "geography(Point,4326)"]) {
      expect(isTextareaType(t)).toBe(true);
    }
  });

  it("does not flag numeric, bool, dates, enums", () => {
    for (const t of ["int4", "numeric", "money", "bool", "date", "timestamp", "timestamptz", "time"]) {
      expect(isTextareaType(t)).toBe(false);
    }
  });
});


describe("displayValueToString", () => {
  it("renders null and undefined as NULL", () => {
    expect(displayValueToString(null)).toBe("NULL");
    expect(displayValueToString(undefined)).toBe("NULL");
  });

  it("renders objects and arrays as JSON text", () => {
    expect(displayValueToString({ a: 1 })).toBe('{"a":1}');
    expect(displayValueToString([1, 2])).toBe("[1,2]");
  });

  it("renders scalars via String()", () => {
    expect(displayValueToString(42)).toBe("42");
    expect(displayValueToString(true)).toBe("true");
    expect(displayValueToString("hi")).toBe("hi");
  });

  it("shows a readable preview for bytea values", () => {
    expect(displayValueToString("\\x68656c6c6f", "bytea")).toBe('"hello" (5 B)');
    expect(displayValueToString("\\x68656c6c6f" + "0a776f726c64", "bytea")).toContain('"hello');
    expect(displayValueToString("\\x00ff", "bytea")).toBe("⟨2 B binary⟩");
    expect(displayValueToString("hi", "bytea")).toBe("hi");
  });
});

describe("isArrayType", () => {
  it("flags both wire (`_text`) and format_type (`text[]`) spellings", () => {
    for (const t of ["_text", "_int4", "_bool", "_uuid", "_jsonb", "text[]", "integer[]", "boolean[]", "uuid[]", "jsonb[]"]) {
      expect(isArrayType(t)).toBe(true);
    }
  });

  it("does not flag scalar or underscore-prefixed custom types", () => {
    for (const t of ["text", "int4", "jsonb", "money", "_my_custom_type"]) {
      expect(isArrayType(t)).toBe(false);
    }
  });
});

describe("isJsonType", () => {
  it("flags json and jsonb only", () => {
    expect(isJsonType("json")).toBe(true);
    expect(isJsonType("jsonb")).toBe(true);
    expect(isJsonType("text")).toBe(false);
    expect(isJsonType("_jsonb")).toBe(false);
  });
});

describe("getInputType", () => {
  it("returns array/json for their types", () => {
    expect(getInputType("_text")).toBe("array");
    expect(getInputType("integer[]")).toBe("array");
    expect(getInputType("jsonb")).toBe("json");
  });
});

describe("arrayToPgLiteral", () => {
  it("serializes arrays with proper escaping", () => {
    expect(arrayToPgLiteral(["a", "b", "c"])).toBe("{a,b,c}");
    expect(arrayToPgLiteral(["a b", "c,d", 'e"f'])).toBe('{"a b","c,d","e\\"f"}');
    expect(arrayToPgLiteral(["", null])).toBe('{"",""}');
    expect(arrayToPgLiteral([])).toBe("{}");
  });
});

describe("parsePgArrayLiteral", () => {
  it("parses simple and quoted literals", () => {
    expect(parsePgArrayLiteral("{a,b,c}")).toEqual(["a", "b", "c"]);
    expect(parsePgArrayLiteral('{"a b","c,d"}')).toEqual(["a b", "c,d"]);
    expect(parsePgArrayLiteral('{"e\\"f"}')).toEqual(['e"f']);
    expect(parsePgArrayLiteral("{}")).toEqual([]);
  });

  it("maps NULL elements to the empty marker and rejects malformed input", () => {
    expect(parsePgArrayLiteral("{a,NULL,c}")).toEqual(["a", "", "c"]);
    expect(parsePgArrayLiteral("{a,b")).toBeNull();
    expect(parsePgArrayLiteral("a,b")).toBeNull();
    expect(parsePgArrayLiteral("{{a,b},{c,d}}")).toBeNull();
  });
});

describe("formatValueForInput", () => {
  it("prefills JSONB/array values with their JSON text form", () => {
    expect(formatValueForInput({ a: 1 }, "text")).toBe('{"a":1}');
    expect(formatValueForInput([1, 2], "text")).toBe("[1,2]");
    expect(formatValueForInput(null, "text")).toBe("");
  });

  it("keeps scalar prefill behavior", () => {
    expect(formatValueForInput(5, "text")).toBe("5");
    expect(formatValueForInput("abc", "text")).toBe("abc");
  });
});
