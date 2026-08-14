import { describe, it, expect } from "vitest";
import { displayValueToString, formatValueForInput, isNumericType, isTextareaType } from "./field-types";

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
