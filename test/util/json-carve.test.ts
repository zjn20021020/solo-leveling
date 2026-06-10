import { describe, it, expect } from "vitest";
import { carveJsonObject, parseEmbeddedObject } from "../../src/util/json-carve.js";

describe("carveJsonObject", () => {
  it("returns the object from clean JSON", () => {
    expect(carveJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("extracts the FIRST balanced object when several are present", () => {
    // A greedy regex would span to the last brace; the scanner stops at the first close.
    expect(carveJsonObject('{"a":1} trailing {"b":2}')).toBe('{"a":1}');
  });

  it("handles nested objects", () => {
    const s = '{"a":{"b":{"c":3}},"d":4}';
    expect(carveJsonObject(s)).toBe(s);
  });

  it("ignores braces inside strings", () => {
    const s = '{"text":"a } b { c"}';
    expect(carveJsonObject(s)).toBe(s);
  });

  it("respects escaped quotes inside strings", () => {
    const s = '{"text":"she said \\"}\\" loudly"}';
    expect(carveJsonObject(s)).toBe(s);
  });

  it("strips surrounding prose and fences", () => {
    const s = 'Here you go:\n```json\n{"ok":true}\n```\nDone.';
    expect(carveJsonObject(s)).toBe('{"ok":true}');
  });

  it("returns null when there is no opening brace", () => {
    expect(carveJsonObject("no json here")).toBeNull();
  });

  it("returns null for an unbalanced object", () => {
    expect(carveJsonObject('{"a":1')).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(carveJsonObject("")).toBeNull();
  });
});

describe("parseEmbeddedObject", () => {
  it("parses a wrapped object into a record", () => {
    expect(parseEmbeddedObject('prefix {"x":5} suffix')).toEqual({ x: 5 });
  });

  it("returns null when the carved text is not valid JSON", () => {
    expect(parseEmbeddedObject("{not json}")).toBeNull();
  });

  it("returns null when there is no object", () => {
    expect(parseEmbeddedObject("plain text")).toBeNull();
  });
});
