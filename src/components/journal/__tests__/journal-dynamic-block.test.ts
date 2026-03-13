// §56f Journal Dynamic Block — unit tests for pure parsing helpers
import { describe, expect, test } from "vitest";

import { parseBlockParams, parseRange } from "../JournalDynamicBlock";

describe("parseBlockParams", () => {
  test("parses key: value pairs", () => {
    const content = "range: 2026-02-01..2026-02-28\nstyle: trend\ncolumns: 4";
    const params = parseBlockParams(content);
    expect(params.range).toBe("2026-02-01..2026-02-28");
    expect(params.style).toBe("trend");
    expect(params.columns).toBe("4");
  });

  test("ignores lines without colon", () => {
    const params = parseBlockParams("no-colon-here\nkey: val");
    expect(Object.keys(params)).toEqual(["key"]);
    expect(params.key).toBe("val");
  });

  test("trims whitespace from values", () => {
    const params = parseBlockParams("key:   spaced value   ");
    expect(params.key).toBe("spaced value");
  });

  test("returns empty object for empty content", () => {
    expect(parseBlockParams("")).toEqual({});
    expect(parseBlockParams("\n\n")).toEqual({});
  });

  test("handles single key-value pair", () => {
    const params = parseBlockParams("range: 2026-01-01..2026-01-31");
    expect(params.range).toBe("2026-01-01..2026-01-31");
  });
});

describe("parseRange", () => {
  test("parses valid range", () => {
    const result = parseRange("2026-02-01..2026-02-28");
    expect(result).toEqual(["2026-02-01", "2026-02-28"]);
  });

  test("parses single-day range (start == end)", () => {
    const result = parseRange("2026-01-15..2026-01-15");
    expect(result).toEqual(["2026-01-15", "2026-01-15"]);
  });

  test("parses cross-month range", () => {
    const result = parseRange("2025-12-20..2026-01-10");
    expect(result).toEqual(["2025-12-20", "2026-01-10"]);
  });

  test("returns null for empty string", () => {
    expect(parseRange("")).toBeNull();
  });

  test("returns null for missing separator", () => {
    expect(parseRange("2026-02-01 2026-02-28")).toBeNull();
  });

  test("returns null for wrong date format", () => {
    expect(parseRange("26-02-01..26-02-28")).toBeNull();
  });

  test("returns null for partial input", () => {
    expect(parseRange("2026-02-01..")).toBeNull();
    expect(parseRange("..2026-02-28")).toBeNull();
  });

  test("returns null for single dot separator", () => {
    expect(parseRange("2026-02-01.2026-02-28")).toBeNull();
  });
});
