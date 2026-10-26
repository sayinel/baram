// §72 Pure TypeScript utilities for the YAML properties panel — no React dependencies.
//
// The panel edits one property at a time, and every edit rewrites only that property's lines:
// the other keys, their block lists, comments, quoting and line breaks stay byte for byte. It
// used to parse every `key: value` line it found and write them all back from that, which
// dropped block lists (their `- a` lines have no colon), comments and nested maps, and wrote a
// typed `#new` chip as `tags: [..., #new]`, which YAML cannot parse.

import { tagName } from "../tags/tag-name";
import {
  appendFrontmatterLine,
  frontmatterListItems,
  writeFrontmatterList,
} from "./frontmatter-list";
import { yamlPropertyValue, yamlString } from "./yaml-scalar";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PropertyEntry {
  /** The key as the front matter spells it, quotes included. */
  key: string;
  type: PropertyType;
  /** A string or enum property's value; an array property's items — a `tags` item by its name. */
  value: string | string[];
}

export type PropertyType = "array" | "enum" | "string";

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
 * edit: each top-level key, once (the first, if a key repeats). A string or enum property is a
 * one-line value, shown without its quotes. An array property (`ARRAY_KEYS`) shows its list
 * items as the list reader reads them (`frontmatterListItems`), a `tags` item by its tag name;
 * a one-line scalar under such a key shows as its one item. A key whose value the panel cannot
 * show — a nested map, a block scalar (`|`, `>`), a flow collection under a string key, a list
 * under a string key, an anchor, an alias or a YAML tag — is left out, so no edit reaches it.
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
      } else if (!field.continued && !NOT_SHOWN.test(field.value)) {
        entries.push({
          key: field.key,
          type: "array",
          value: [scalarText(field.value)],
        });
      }
      continue;
    }
    if (field.continued || NOT_SHOWN.test(field.value)) continue;
    entries.push({
      key: field.key,
      type: ENUM_KEYS.has(field.key) ? "enum" : "string",
      value: scalarText(field.value),
    });
  }
  return entries;
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

/**
 * Adds the property `key` at the end of the front matter (`appendFrontmatterLine`) — an empty
 * list for an array key, an empty string otherwise. A key already there is left as it is.
 */
export function addYamlProperty(
  yaml: string,
  key: string,
  type: PropertyType,
): string {
  if (topLevelFields(yaml).some((f) => f.key === key)) return yaml;
  const value = type === "array" ? "[]" : yamlPropertyValue("");
  return appendFrontmatterLine(yaml, `${yamlString(key)}: ${value}`);
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
 * Sets the string or enum property `key` to `value`, written so YAML reads back that text
 * (`yamlPropertyValue`) on the key's own line, which keeps its spelling of the key. A key not
 * there is added at the end.
 */
export function setYamlPropertyValue(
  yaml: string,
  key: string,
  value: string,
): string {
  const field = topLevelFields(yaml).find((f) => f.key === key);
  if (!field) {
    return appendFrontmatterLine(
      yaml,
      `${yamlString(key)}: ${yamlPropertyValue(value)}`,
    );
  }
  return (
    yaml.slice(0, field.start) +
    `${field.keyText} ${yamlPropertyValue(value)}` +
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

/**
 * A one-line value the panel cannot show as text: a flow collection, a block scalar, an
 * anchor, an alias or a YAML tag.
 */
const NOT_SHOWN = /^[[{|>&*!]/;

/**
 * A top-level key line: the key at column 0 — plain, or quoted — and its colon, followed by
 * whitespace or the end of the line.
 */
const KEY_LINE =
  /^((?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#\-"'?:][^\n]*?)[ \t]*:)(?:[ \t]+([^\n]*)|[ \t]*)$/;

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
