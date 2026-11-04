// §56m How the app spells a value it writes into front matter.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { frontmatterListItems } from "../frontmatter-list";
import {
  coreScalarKind,
  hasNonPrintable,
  isCalendarDate,
  quotedScalar,
  yamlPropertyValue,
  yamlString,
} from "../yaml-scalar";

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

describe("coreScalarKind", () => {
  // The YAML 1.2 core schema (§10.3.2) is what `yaml` resolves plain scalars with: each
  // spelling here must get the kind `yaml` gives it. What turns this red: a pattern that is
  // not the schema's — `True` and `0o17` resolved, `yes` and `0b1` not.
  it.each([
    "",
    "~",
    "null",
    "Null",
    "NULL",
    "nULL",
    "true",
    "True",
    "TRUE",
    "tRUE",
    "false",
    "False",
    "yes",
    "no",
    "on",
    "0",
    "-1",
    "+3",
    "007",
    "0o17",
    "0x1F",
    "0b1",
    "1_000",
    "1.5",
    "1.50",
    "1.0",
    "-0.5",
    ".5",
    "1.",
    "1e3",
    "1E-3",
    "+.inf",
    "-.Inf",
    ".NaN",
    ".nan",
    "inf",
    "12:30",
    "2024-01-01",
    "a",
    "1st",
  ])("reads %j as YAML 1.2 does", (plain) => {
    const value = parse(`v: ${plain}`).v as unknown;
    const kind =
      value === null
        ? "null"
        : typeof value === "boolean"
          ? "bool"
          : typeof value === "number"
            ? "number"
            : "string";
    expect(coreScalarKind(plain)).toBe(kind);
  });
});

describe("isCalendarDate (M7)", () => {
  // What turns this red: taking any `NNNN-NN-NN` for a date — `2026-13-45` stayed plain, a
  // string YAML 1.1 readers try to read as a timestamp.
  it("takes only days the calendar has", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-03-01")).toBe(true);
    expect(isCalendarDate("2023-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-45")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
    expect(yamlPropertyValue("2026-13-45")).toBe(`"2026-13-45"`);
    expect(yamlPropertyValue("2024-02-29")).toBe("2024-02-29");
  });
});

describe("quotedScalar with characters outside YAML's printable set (M5)", () => {
  // What turns this red: writing them as they are — a single-quoted scalar cannot hold a
  // control character, and `JSON.stringify` leaves DEL, the C1 controls, U+FFFE and U+FFFF raw
  // inside double quotes. yaml 2.9.1 and js-yaml read those back without complaint, but a YAML
  // stream may hold only printable characters (§5.1), so each is written as an escape.
  it.each([
    ["a\u0001b", '"a\\u0001b"'],
    ["x\u001b[0m", '"x\\u001b[0m"'],
    ["a\u007fb", '"a\\u007Fb"'],
    ["a\u0080b", '"a\\u0080b"'],
    ["a\u0084b", '"a\\u0084b"'],
    ["a\u0086b", '"a\\u0086b"'],
    ["a\u009fb", '"a\\u009Fb"'],
    ["a\ufffeb", '"a\\uFFFEb"'],
    ["a\uffffb", '"a\\uFFFFb"'],
    ["a\ud800b", '"a\\ud800b"'],
    ["a\udc00b", '"a\\udc00b"'],
    ['a"\u007fb', '"a\\"\\u007Fb"'],
  ])("writes %j as %s, which YAML reads back", (value, written) => {
    expect(quotedScalar(value)).toBe(written);
    expect(hasNonPrintable(written)).toBe(false);
    expect(parse(`v: ${written}`)).toEqual({ v: value });
  });

  // The sibling: NEL and tab are printable, and a value with nothing to escape keeps them.
  it("keeps a tab and NEL as they are, which YAML can hold", () => {
    expect(quotedScalar("a\u0085b")).toBe('"a\u0085b"');
    for (const value of ['a\tb"c', 'a\u0085b"c']) {
      expect(quotedScalar(value)).toBe(`'${value}'`);
      expect(parse(`v: ${quotedScalar(value)}`)).toEqual({ v: value });
    }
  });

  // Every spelling the writers give the shared fixture's names, and every character in the
  // ranges the escape covers, is printable.
  it("writes only printable characters", () => {
    const { names } = JSON.parse(
      readFileSync(
        join(process.cwd(), "src-tauri/src/tag/fixtures/frontmatter-tags.json"),
        "utf8",
      ),
    ) as { names: { name: string }[] };
    const values = names.map((row) => row.name);
    for (let cp = 0; cp <= 0xa0; cp++)
      values.push(`a${String.fromCharCode(cp)}b`);
    values.push("a\ufffeb", "a\uffffb", "a\ud800b", "a\udfffb");
    for (const value of values) {
      for (const written of [
        quotedScalar(value),
        yamlString(value),
        yamlPropertyValue(value),
      ]) {
        expect(hasNonPrintable(written), JSON.stringify(value)).toBe(false);
      }
    }
  });
});
