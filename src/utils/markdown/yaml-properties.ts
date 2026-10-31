// §72 Pure TypeScript utilities for the YAML properties panel — no React dependencies.
//
// The panel edits one property at a time, and every edit rewrites only that property's lines:
// the other keys, their block lists, comments, quoting and line breaks stay byte for byte. It
// used to parse every `key: value` line it found and write them all back from that, which
// dropped block lists (their `- a` lines have no colon), comments and nested maps, and wrote a
// typed `#new` chip as `tags: [..., #new]`, which YAML cannot parse.

import { parseDocument, visit } from "yaml";

import { tagName } from "../tags/tag-name";
import {
  appendFrontmatterLine,
  frontmatterListItems,
  writableFrontmatterList,
  writeFrontmatterList,
} from "./frontmatter-list";
import {
  coreScalarKind,
  hasNonPrintable,
  quotedScalar,
  yamlPropertyValue,
  yamlString,
} from "./yaml-scalar";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PropertyEntry {
  /** The key as the front matter spells it, quotes included. */
  key: string;
  /** A string, enum or `yaml` property's value as the front matter spells it. */
  raw?: string;
  type: PropertyType;
  /** A string or enum property's value; an array property's items — a `tags` item by its name. */
  value: string | string[];
}

/**
 * `yaml`: a one-line value shown and written as its YAML text, as typed — a value in YAML's own
 * syntax (a flow map, an anchor, an alias, a YAML tag, a flow list the list writer cannot
 * rewrite) or one whose text the panel cannot show as such (a plain value with a comment, a
 * double-quoted one with an escape JSON does not have). It is written only when it is valid
 * YAML there (`isWritableYamlValue`).
 */
export type PropertyType = "array" | "enum" | "string" | "yaml";

// Keys that are always treated as arrays
export const ARRAY_KEYS = new Set(["requires", "tags"]);

// Keys that are treated as enums
export const ENUM_KEYS = new Set(["status"]);
export const ENUM_VALUES: Record<string, string[]> = {
  status: ["draft", "active", "deprecated"],
};

// ─── Parse ────────────────────────────────────────────────────────────────────

/**
 * The properties of a YAML frontmatter string (without its `---` fences) the panel can show and
 * edit: each top-level key, once (the first, if a key repeats).
 *
 * - An array key (`ARRAY_KEYS`) shows its list items as the list reader reads them
 *   (`frontmatterListItems`), a `tags` item by its tag name; a one-line scalar under such a key
 *   shows as its one item.
 * - Any other key holding a list the list writer can rewrite in place
 *   (`writableFrontmatterList`) — `aliases: [p, q]`, or `aliases:` and `- p` lines — shows its
 *   items, and an edit goes through that writer.
 * - A one-line value in YAML's own syntax (`{a: 1}`, `&a x`, `*a`, `!!str 5`, a flow list the
 *   writer cannot rewrite), a plain value with a comment (`a # c`) and a double-quoted value
 *   with an escape JSON does not have (`"a\x41"`) show as their YAML text, type `yaml`.
 * - Any other one-line value is a string (or an enum, `ENUM_KEYS`), shown without its quotes.
 *   `key:` with nothing after it is an empty string, not an empty list.
 *
 * Left out, so no edit reaches them: a value over several lines that is not such a list (a
 * nested map, an item over two lines) and a block scalar (`|`, `>`). Before, the panel showed
 * a nested map's inner keys as properties of their own and a block scalar as `|`, and any edit
 * flattened the one and emptied the other.
 */
export function parseYamlProperties(yaml: string): PropertyEntry[] {
  const entries: PropertyEntry[] = [];
  const seen = new Set<string>();
  for (const field of topLevelFields(yaml)) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    if (ARRAY_KEYS.has(field.key)) {
      const items = frontmatterListItems(yaml, field.key).map((i) =>
        field.key === "tags" ? tagName(i.value) : i.value,
      );
      if (items.length > 0 || field.value === "" || field.value === "[]") {
        entries.push({
          key: field.key,
          type: "array",
          value: [...new Set(items.filter(Boolean))],
        });
      } else if (!field.continued && !BLOCK_SCALAR.test(field.value)) {
        entries.push({
          key: field.key,
          type: "array",
          value: [scalarText(field.value)],
        });
      }
      continue;
    }
    const list = writableFrontmatterList(yaml, field.key);
    if (
      list &&
      list.start === field.start &&
      (list.form === "inline" || list.items.length > 0)
    ) {
      // Each value once: removing a chip removes every item that holds it.
      entries.push({
        key: field.key,
        type: "array",
        value: [...new Set(list.items.map((i) => i.value))],
      });
      continue;
    }
    if (field.continued || BLOCK_SCALAR.test(field.value)) continue;
    if (YAML_SYNTAX.test(field.value) || !readsAsText(field.value)) {
      entries.push({
        key: field.key,
        raw: field.value,
        type: "yaml",
        value: field.value,
      });
      continue;
    }
    entries.push({
      key: field.key,
      raw: field.value,
      type: ENUM_KEYS.has(field.key) ? "enum" : "string",
      value: scalarText(field.value),
    });
  }
  return entries;
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

/**
 * Adds the property `key` at the end of the front matter (`appendFrontmatterLine`) — an empty
 * list for an array key; otherwise no value (`key:`), so the first value typed takes its own
 * type. A key already there is left as it is.
 */
export function addYamlProperty(
  yaml: string,
  key: string,
  type: PropertyType,
): string {
  if (topLevelFields(yaml).some((f) => f.key === key)) return yaml;
  const line =
    type === "array" ? `${yamlString(key)}: []` : `${yamlString(key)}:`;
  return appendFrontmatterLine(yaml, line);
}

/**
 * Whether writing `text` as the `yaml` property `key`, as typed, keeps `yaml` YAML. Typed one
 * key at a time, a `yaml` value passes through texts that are not YAML; the panel writes only
 * those that are. `text` is refused when:
 *
 * - it is more than one line, or holds a character outside YAML's printable set
 *   (`hasNonPrintable` — a stream may hold no other, YAML 1.2.2 §5.1), which `yaml` reads
 *   without complaint;
 * - it starts a block scalar (`|`, `>`, after any anchor or tag), whose content would be the
 *   lines after it and which the panel does not show;
 * - the front matter with `text` in place has a diagnostic it did not have before the edit:
 *   an error or a warning from the `yaml` package's `parseDocument`, or an alias naming no
 *   anchor set before it (`diagnostics`). A warning refuses as an error does: `!!int x` and
 *   `!x y` are warnings to `yaml` (`TAG_RESOLVE_FAILED`) and errors to js-yaml.
 *
 * What counts as the edit's is decided by the position the parser reports. A diagnostic whose
 * range touches the rewritten span — the key's line, or the line appended for a new key —
 * refuses. One reported elsewhere refuses unless the front matter already had a diagnostic
 * with the same code at the same offset once the edit's change in length is taken off, so a
 * line the edit does not touch that YAML already could not read does not block every edit.
 * The comparison is of sets, not counts: while a field that is already broken is edited, a
 * diagnostic the edit causes but the parser reports on a later line can land where an old one
 * was and pass.
 *
 * Accepted on purpose: redefining an anchor that an alias elsewhere names (`&a y` where `ref:
 * *a` follows) is valid YAML and changes what that alias reads, with no diagnostic. Known
 * difference: `{}: `, `[]: `, `{?}` and `[?]` give `yaml` nothing to report and are written,
 * though js-yaml rejects them.
 */
export function isWritableYamlValue(
  yaml: string,
  key: string,
  text: string,
): boolean {
  if (/[\n\r]/.test(text) || hasNonPrintable(text)) return false;
  // The value after any anchor and tag in front of it.
  if (/^[|>]/.test(text.trim().replace(/^(?:[&!]\S*\s+)+/, ""))) return false;
  const candidate = setYamlPropertyValue(yaml, key, text, { asYaml: true });
  // The span the edit rewrote: the key's line, or the line appended for a new key.
  const field = topLevelFields(yaml).find((f) => f.key === key);
  const start = field ? field.start : yaml.length;
  const shift = candidate.length - yaml.length;
  const end = (field ? field.end : yaml.length) + shift;
  const before = new Set(
    diagnostics(yaml).map(([code, at]) => `${code}@${at}`),
  );
  return diagnostics(candidate).every(([code, at, to]) => {
    if (to >= start && at <= end) return false;
    return before.has(`${code}@${at > end ? at - shift : at}`);
  });
}

/** Removes the property `key` — its key line and every line under it — and one line break. */
export function removeYamlProperty(yaml: string, key: string): string {
  const field = topLevelFields(yaml).find((f) => f.key === key);
  if (!field) return yaml;
  const after = /^\r?\n/.exec(yaml.slice(field.end))?.[0];
  if (after !== undefined) {
    return yaml.slice(0, field.start) + yaml.slice(field.end + after.length);
  }
  const before = /\r?\n$/.exec(yaml.slice(0, field.start))?.[0] ?? "";
  return yaml.slice(0, field.start - before.length) + yaml.slice(field.end);
}

/**
 * Sets the array property `key` to the items `items`, through the list writer the tag bar uses
 * (`writeFrontmatterList`): a `tags` item is matched by its tag name, any other by its value.
 * A list the writer cannot rewrite in place is left as it is.
 */
export function setYamlPropertyItems(
  yaml: string,
  key: string,
  items: string[],
): string {
  const nameOf = key === "tags" ? tagName : (value: string) => value;
  return writeFrontmatterList(yaml, key, items, nameOf);
}

/**
 * Sets the string, enum or `yaml` property `key` to `value` on the key's own line, which keeps
 * its spelling of the key; a key not there is added at the end. A value spelled as the line
 * already has it writes nothing.
 *
 * A `yaml` value (`asYaml`) is YAML text and is written as typed. A string or enum value keeps
 * the type of `original`, the value's spelling when the edit began (by default what the line
 * holds now): `propertySpelling`.
 */
export function setYamlPropertyValue(
  yaml: string,
  key: string,
  value: string,
  options: { asYaml?: boolean; original?: string } = {},
): string {
  const field = topLevelFields(yaml).find((f) => f.key === key);
  if (!field) {
    const spelled = options.asYaml ? value : yamlPropertyValue(value);
    return appendFrontmatterLine(yaml, `${yamlString(key)}: ${spelled}`);
  }
  const spelled = options.asYaml
    ? value
    : propertySpelling(value, options.original ?? field.value);
  if (spelled === field.value) return yaml;
  return (
    yaml.slice(0, field.start) +
    (spelled === "" ? field.keyText : `${field.keyText} ${spelled}`) +
    yaml.slice(field.end)
  );
}

// ─── Internals ────────────────────────────────────────────────────────────────

interface Field {
  /** Whether lines under the key belong to its value (indented lines, or `-` items). */
  continued: boolean;
  /** Offset just past the field's last line, before that line's break. */
  end: number;
  key: string;
  /** The key line up to and including its colon. */
  keyText: string;
  start: number;
  /** The rest of the key line, without the whitespace around it. */
  value: string;
}

/** A block scalar's indicator: its text is on the lines under the key. */
const BLOCK_SCALAR = /^[|>]/;

/** A one-line value in YAML's own syntax: a flow collection, an anchor, an alias or a YAML tag. */
const YAML_SYNTAX = /^[[{&*!]/;

/**
 * A top-level key line: the key at column 0 — plain, or quoted — and its colon, followed by
 * whitespace or the end of the line.
 */
const KEY_LINE =
  /^((?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#\-"'?:][^\n]*?)[ \t]*:)(?:[ \t]+([^\n]*)|[ \t]*)$/;

/**
 * Every error and warning `parseDocument` reports for `yaml` (its code and offset range), and
 * every alias naming no anchor set before it (YAML 1.2.2 §7.1), which `parseDocument` does not
 * report — only `toJS` throws on it. When nothing else is found, a throw from `toJS` is one
 * diagnostic with no place (`-1`).
 */
function diagnostics(yaml: string): [string, number, number][] {
  const doc = parseDocument(yaml);
  const found: [string, number, number][] = [
    ...doc.errors,
    ...doc.warnings,
  ].map((d) => [d.code, d.pos[0], d.pos[1]]);
  visit(doc, {
    Alias: (_, alias) => {
      if (!alias.resolve(doc) && alias.range) {
        found.push(["UNRESOLVED_ALIAS", alias.range[0], alias.range[1]]);
      }
    },
  });
  if (found.length === 0) {
    try {
      doc.toJS();
    } catch {
      found.push(["TO_JS", -1, -1]);
    }
  }
  return found;
}

/**
 * How to write `value` for a property whose value was spelled `original` when the edit began,
 * so that typing never changes its type by accident:
 *
 * - `value` is what `original` shows: `original` itself, quotes, `1.50` and `True` and all — an
 *   edit typed and then undone writes back what was there.
 * - `original` is a plain number, boolean or null by the YAML 1.2 core schema
 *   (`coreScalarKind`) and `value` reads as the same kind: `value` plain (`-1`, `1.50`, `0x1F`,
 *   `True`, `~`).
 * - `original` is empty or null (`~`) — no type to keep — or `value` reads as a string:
 *   `yamlPropertyValue`.
 * - Otherwise — a string original and a value that would read as a number, a boolean or null —
 *   `value` quoted, so it stays a string.
 */
function propertySpelling(value: string, original: string): string {
  if (readsAsText(original) && scalarText(original) === value) return original;
  const kind = /^["']/.test(original) ? "string" : coreScalarKind(original);
  const next = coreScalarKind(value);
  if (next === kind && kind !== "string") return value;
  if (kind === "null" || next === "string") return yamlPropertyValue(value);
  return quotedScalar(value);
}

/**
 * Whether the panel can show a one-line value as text and write its text back: a whole
 * double-quoted scalar whose escapes JSON reads, a whole single-quoted one, or a plain one with
 * no comment — a `#` at the start (`key: # note`, which YAML reads as null) or after
 * whitespace begins one.
 */
function readsAsText(raw: string): boolean {
  if (/^"(?:[^"\\]|\\.)*"$/.test(raw)) {
    try {
      JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  }
  if (/^'(?:[^']|'')*'$/.test(raw)) return true;
  return !/^["'#]/.test(raw) && !/\s#/.test(raw);
}

/** A one-line value as text: without the quotes around it, a plain value as it is. */
function scalarText(raw: string): string {
  if (/^"(?:[^"\\]|\\.)*"$/.test(raw)) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw;
    }
  }
  if (/^'(?:[^']|'')*'$/.test(raw)) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

/**
 * The top-level fields of `yaml`, in order. A field runs from its key line through the last
 * line under it that is indented or a `-` item; blank and comment lines count only when such a
 * line follows them, and the next column-0 line that is neither ends it.
 */
function topLevelFields(yaml: string): Field[] {
  const fields: Field[] = [];
  let field: Field | null = null;
  let start = 0;
  for (const piece of yaml.split("\n")) {
    const text = piece.endsWith("\r") ? piece.slice(0, -1) : piece;
    const lineStart = start;
    start += piece.length + 1;
    const key = KEY_LINE.exec(text);
    if (key) {
      field = {
        continued: false,
        end: lineStart + text.length,
        key: key[1].replace(/[ \t]*:$/, ""),
        keyText: key[1],
        start: lineStart,
        value: (key[2] ?? "").trim(),
      };
      fields.push(field);
      continue;
    }
    if (!field || /^[ \t]*(?:#|$)/.test(text)) continue;
    if (/^(?:[ \t]+\S|-)/.test(text)) {
      field.continued = true;
      field.end = lineStart + text.length;
      continue;
    }
    field = null;
  }
  return fields;
}
