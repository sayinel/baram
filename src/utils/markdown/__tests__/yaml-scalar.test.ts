// §56m How the app spells a value it writes into front matter.
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { frontmatterListItems } from "../frontmatter-list";
import { quotedScalar, yamlPropertyValue, yamlString } from "../yaml-scalar";

/** What the app's list reader reads back from a one-item flow list. */
function readBack(spelling: string): string {
  return frontmatterListItems(`tags: [${spelling}]`, "tags")[0].value;
}

describe("yamlString", () => {
  it("leaves a plain-safe value unquoted", () => {
    for (const value of [
      "solo",
      "project/baram",
      "일기",
      "baram-dev",
      "1st",
      "a b",
    ]) {
      expect(yamlString(value)).toBe(value);
      expect(parse(`v: ${yamlString(value)}`)).toEqual({ v: value });
    }
  });

  // What turns this red: writing a value as it is — `#solo` opens a comment, `key: v` a
  // mapping, `2024` an integer, `true` a boolean.
  it("quotes a value YAML 1.2 would not read back as that text", () => {
    for (const value of [
      "#solo",
      "a, b",
      "key: value",
      "x #y",
      "[x",
      "true",
      "null",
      "2024",
      "2024-01-01",
      "a  b",
      " a",
      "",
    ]) {
      expect(yamlString(value)).not.toBe(value);
      expect(parse(`v: ${yamlString(value)}`)).toEqual({ v: value });
      expect(parse(`v: [${yamlString(value)}]`)).toEqual({ v: [value] });
    }
  });

  // `yaml` reads these as strings (YAML 1.2), so the oracle above cannot see this rule: a
  // YAML 1.1 reader takes them for booleans, and the rule is there for it.
  it("quotes the words a YAML 1.1 reader takes for booleans", () => {
    for (const word of ["yes", "No", "on", "OFF", "y", "n"]) {
      expect(yamlString(word)).toBe(`"${word}"`);
    }
  });
});

describe("quotedScalar", () => {
  // What turns this red: a JSON string for every value — the app's readers take quotes off
  // without reading escapes, so `"a\"b"` came back as `a\"b`.
  it("picks quotes the app's readers read back without escapes", () => {
    for (const [value, spelling] of [
      ["#solo", `"#solo"`],
      ['a"b', `'a"b'`],
      ["a\\b", "'a\\b'"],
      ["a\tb", "'a\tb'"],
    ]) {
      expect(quotedScalar(value)).toBe(spelling);
      expect(parse(`v: ${spelling}`)).toEqual({ v: value });
      expect(readBack(spelling)).toBe(value);
    }
  });

  it("falls back to a JSON string, which YAML reads back, for the rest", () => {
    for (const value of [`it's "x"`, "a\nb"]) {
      expect(quotedScalar(value)).toBe(JSON.stringify(value));
      expect(parse(`v: ${quotedScalar(value)}`)).toEqual({ v: value });
    }
  });
});

describe("yamlPropertyValue", () => {
  // What turns this red: quoting a number, a date or a boolean — `energy: "3"` is no longer
  // the number the journal's stats read, and `date: "2026-03-01"` no longer what its search
  // filter matches.
  it("keeps a number, a date or a boolean in its plain spelling", () => {
    for (const value of ["3", "0", "1.5", "2026-03-01", "true", "false"]) {
      expect(yamlPropertyValue(value)).toBe(value);
      expect(String(parse(`v: ${value}`).v)).toBe(value);
    }
  });

  it("quotes one YAML would give back as other text", () => {
    for (const value of [
      "007",
      "1.10",
      "1e5",
      "yes",
      "null",
      "a: b",
      "#x",
      "",
    ]) {
      expect(yamlPropertyValue(value)).not.toBe(value);
      expect(parse(`v: ${yamlPropertyValue(value)}`)).toEqual({ v: value });
    }
  });
});
