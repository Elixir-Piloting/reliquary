import { describe, it, expect } from "vitest";
import { displayValueToString, formatValueForInput } from "./field-types";

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
