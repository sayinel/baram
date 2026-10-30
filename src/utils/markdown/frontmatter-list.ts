// §56m A front-matter list field (`tags:`, `aliases:`) read item by item, and rewritten so
// YAML still reads it.
//
// The reader walks the lines the way the backend's front-matter tag reader
// (`extract_frontmatter_tags`) does, so the app and the tag index name the same tags. The writer
// changes only what an edit touches: a kept block item keeps its line, comment and all; an
// inline list is rewritten on its own line. It rewrites only a list it read to its end, and
// leaves the field alone otherwise — writing over the first part of a list it did not read
// strands the rest. The writers it replaced joined bare values with `, `: a value that starts
// with `#` became `tags: [#solo]` or `[a, #solo]`, and the whole front matter failed to parse —
// a plain scalar cannot begin with `#`, and after a space `#` begins a comment, so the flow list
// never closes.

import { yamlString } from "./yaml-scalar";

/** One list field as the YAML spells it. */
export interface FrontmatterList {
  /**
   * Whether a writer may rewrite the list in place. Inline: nothing but blanks and a comment
   * follows `]`, every quote closes, no item opens a nested `[` or `{`. Block: past the last
   * item, and any blank or comment lines after it, the next line is neither indented nor a
   * `-` line — it is not a continuation of an item, nor an item after a gap.
   */
  complete: boolean;
  /** Offset just past the list: its `]`, or the end of its last line (before that line's break). */
  end: number;
  /** `inline` — `field: [a, b]`; `block` — `field:` and then `- a` lines, or none. */
  form: "block" | "inline";
  items: FrontmatterListItem[];
  /** The key line up to and including its colon — `tags:`, `Tags :`. */
  key: string;
  /** Block form: every line read as part of the list, an item or a blank `-`, as written. */
  lines: FrontmatterListLine[];
  /** The line break after the key line — `\n` or `\r\n` — or the document's, on the last line. */
  newline: string;
  /** Inline form: the offset of `[`. Block form: the end of the key line. */
  open: number;
  /** Offset of the key line. */
  start: number;
}

export interface FrontmatterListItem {
  /** Block form: the text in front of the item on its line, `  - `. */
  lead?: string;
  /** The item as written, without the whitespace around it — quotes included. */
  raw: string;
  /** What the item says: `raw` without its quotes, as the readers take them off. */
  value: string;
}

/** A line of a block list: the line break before it and its text, with the item it holds. */
export interface FrontmatterListLine {
  item?: FrontmatterListItem;
  sep: string;
  text: string;
}

/**
 * Appends `line` to the front matter `yaml` at column 0, after everything in it — a key put
 * after the first line could land inside that line's value (a block list, a `|` scalar). A
 * front matter that ended with a line break still does.
 */
export function appendFrontmatterLine(yaml: string, line: string): string {
  if (yaml === "") return line;
  const newline = yaml.includes("\r\n") ? "\r\n" : "\n";
  return yaml.endsWith("\n") ? yaml + line + newline : yaml + newline + line;
}

/** A flow list `[a, b]` of the items' spellings (see {@link listItemSpelling}). */
export function flowList(items: (FrontmatterListItem | string)[]): string {
  return `[${items.map((i) => listItemSpelling(i, true)).join(", ")}]`;
}

/** Every item of every `field` list in `yaml`, in order — what the readers name. */
export function frontmatterListItems(
  yaml: string,
  field: string,
): FrontmatterListItem[] {
  return readFrontmatterLists(yaml, field).flatMap((list) => list.items);
}

/**
 * How to write an item into a flow (`flow`) or block list. A string is a new value
 * (`yamlString`). An item that was read keeps its spelling unless YAML cannot read it: in a
 * flow list, unless it is quoted or reads as one plain scalar (of whatever type — `123` and
 * `null` stay as they are); in a block list, unless it starts with `#` (a comment), a reserved
 * indicator (`@`, `` ` ``, `%`) or a quote that does not close. Then its value is written as a
 * new one.
 */
export function listItemSpelling(
  item: FrontmatterListItem | string,
  flow: boolean,
): string {
  if (typeof item === "string") return yamlString(item);
  const readable = flow
    ? DOUBLE_QUOTED.test(item.raw) ||
      SINGLE_QUOTED.test(item.raw) ||
      readsPlainInFlow(item.raw)
    : !blockItemUnreadable(item.raw);
  return readable ? item.raw : yamlString(item.value);
}

/**
 * Every `field` list of `yaml` (front matter without its `---` fences), in order, read line by
 * line as the backend's front-matter tag reader reads `tags`: a line is cut at `\n` and loses
 * one `\r` before it; the key matches in any case, with whitespace allowed before its colon; a
 * list is `field: [a, b]` on the key's line, or `field:` alone and then the `- a` lines after
 * it, indented or not, up to the first line that is not one. Whitespace is Unicode's
 * (`White_Space`, as Rust's `char::is_whitespace`). An item's value is its text less every `"`
 * at either end, then every `'` — no escape is read.
 *
 * The backend's reader and this one read the cases of
 * `src-tauri/src/tag/fixtures/frontmatter-tags.json` in their tests. The one reading that
 * differs there is on purpose, and those cases say so (`frontendTags`): in `field: [a, b]` a
 * comma inside a quoted item does not split it — `["a, b"]` and `["a\", b"]` are one item here
 * and two there — so that writing the list back keeps the item whole.
 */
export function readFrontmatterLists(
  yaml: string,
  field: string,
): FrontmatterList[] {
  const key = escapeRegExp(field);
  const inlineRe = new RegExp(`^(${key}${WS}*:)${WS}*\\[([^\\]]*)\\]`, "iu");
  const headerRe = new RegExp(`^(${key}${WS}*:)${WS}*$`, "iu");
  const itemRe = new RegExp(`^(${WS}*-${WS}+)([^\\n]+)$`, "u");
  const lines = splitLines(yaml);
  const documentNewline = yaml.includes("\r\n") ? "\r\n" : "\n";
  const lists: FrontmatterList[] = [];
  let block: FrontmatterList | null = null;

  for (let i = 0; i < lines.length; i++) {
    const { break: lineBreak, start, text } = lines[i];
    if (block) {
      const item = itemRe.exec(text);
      if (item) {
        const raw = whitespaceTrim(item[2]);
        const read = raw ? { lead: item[1], raw, value: unquote(raw) } : null;
        if (read) block.items.push(read);
        block.lines.push({
          ...(read && { item: read }),
          sep: lines[i - 1].break,
          text,
        });
        block.end = start + text.length;
        continue;
      }
      block.complete = blockEndsAt(lines, i);
      block = null;
    }

    const inline = inlineRe.exec(text);
    if (inline) {
      const split = splitFlowItems(inline[2]);
      const rest = text.slice(inline[0].length);
      lists.push({
        complete:
          !split.unclosed &&
          !split.nested &&
          /^(?:[ \t]+#[^\n]*)?[ \t]*$/.test(rest),
        end: start + inline[0].length,
        form: "inline",
        items: split.items.map((raw) => ({ raw, value: unquote(raw) })),
        key: inline[1],
        lines: [],
        newline: lineBreak || documentNewline,
        open: start + inline[0].length - inline[2].length - 2,
        start,
      });
      continue;
    }

    const header = headerRe.exec(text);
    if (header) {
      block = {
        complete: true,
        end: start + text.length,
        form: "block",
        items: [],
        key: header[1],
        lines: [],
        newline: lineBreak || documentNewline,
        open: start + text.length,
        start,
      };
      lists.push(block);
    }
  }
  return lists;
}

/**
 * Rewrites the `field` list of `yaml` to hold the names `names`, where an item's name is
 * `nameOf(item.value)`. An item whose name is not in `names` is removed — with its line, in a
 * block list; every other item stays as written (an item with no name too), except that one YAML
 * cannot read is respelled (`listItemSpelling`). A name no item has is added at the end, in the
 * list's form and lead, with its line break. A block list this edit leaves with nothing is
 * written `field: []`.
 * The lines an edit does not touch stay byte for byte, so writing back the names a list already
 * has changes nothing but the respelling of items YAML cannot read.
 *
 * Without a `field` key, `field: [...]` is appended at the end (`appendFrontmatterLine`). The
 * field is left alone, and `yaml` returned unchanged, when it is there in a form this cannot
 * rewrite: a scalar, a quoted key, a list not read to its end (`complete`), or more than one
 * key that reads as `field` — which of them YAML keeps is not this writer's to choose.
 */
export function writeFrontmatterList(
  yaml: string,
  field: string,
  names: string[],
  nameOf: (value: string) => string,
): string {
  if (keyLineCount(yaml, field) === 0) {
    return names.length > 0
      ? appendFrontmatterLine(yaml, `${field}: ${flowList(names)}`)
      : yaml;
  }
  const list = writableFrontmatterList(yaml, field);
  if (!list) return yaml;

  const wanted = new Set(names);
  const stays = (item: FrontmatterListItem) => {
    const name = nameOf(item.value);
    return !name || wanted.has(name);
  };
  const present = new Set(list.items.map((i) => nameOf(i.value)));
  const added = names.filter((name) => !present.has(name));

  if (list.form === "inline") {
    const parts = [...list.items.filter(stays), ...added].map((i) =>
      listItemSpelling(i, true),
    );
    return `${yaml.slice(0, list.open)}[${parts.join(", ")}]${yaml.slice(list.end)}`;
  }

  const lead = list.items[0]?.lead ?? "  - ";
  const kept = list.lines
    .filter((line) => !line.item || stays(line.item))
    .map(({ item, sep, text }) =>
      item && blockItemUnreadable(item.raw)
        ? `${sep}${item.lead}${listItemSpelling(item.value, false)}`
        : `${sep}${text}`,
    );
  if (kept.length + added.length === 0) {
    // An empty `field:` stays as it is; one emptied by this edit becomes `field: []`.
    if (list.lines.length === 0) return yaml;
    return `${yaml.slice(0, list.start)}${list.key} []${yaml.slice(list.end)}`;
  }
  const appended = added.map(
    (name) => `${list.newline}${lead}${listItemSpelling(name, false)}`,
  );
  return (
    yaml.slice(0, list.open) +
    kept.join("") +
    appended.join("") +
    yaml.slice(list.end)
  );
}

/**
 * The one `field` list `writeFrontmatterList` rewrites in place, or null when it would leave
 * the field alone: no key, more than one key that reads as `field` (quoted, or in another case),
 * a key whose value is not a list, or a list not read to its end (`complete`).
 */
export function writableFrontmatterList(
  yaml: string,
  field: string,
): FrontmatterList | null {
  if (keyLineCount(yaml, field) !== 1) return null;
  const lists = readFrontmatterLists(yaml, field);
  return lists.length === 1 && lists[0].complete ? lists[0] : null;
}

/** Unicode whitespace (`White_Space`), the set Rust's `char::is_whitespace` and `\s` use. */
const WS = "\\p{White_Space}";

const DOUBLE_QUOTED = /^"(?:[^"\\]|\\.)*"$/;
const SINGLE_QUOTED = /^'(?:[^']|'')*'$/;

interface Line {
  /** The line break that ends the line: `\n`, `\r\n`, or `""` on the last line. */
  break: string;
  start: number;
  /** The line without its `\n`, and without the one `\r` before that `\n`. */
  text: string;
}

/** `s` with the characters a regular expression gives a meaning to escaped. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How many lines of `yaml` start with a key that reads as `field`, quoted or not, in any case. */
function keyLineCount(yaml: string, field: string): number {
  const keyRe = new RegExp(`^["']?${escapeRegExp(field)}["']?${WS}*:`, "iu");
  return splitLines(yaml).filter((line) => keyRe.test(line.text)).length;
}

/**
 * Whether a block list ending before line `i` was read to its end: past blank and comment lines,
 * the next line is neither indented (a continuation of the last item, or an item after a gap)
 * nor a `-` line (an item the walk could not read, such as a bare `-`).
 */
function blockEndsAt(lines: Line[], i: number): boolean {
  for (let j = i; j < lines.length; j++) {
    const { text } = lines[j];
    if (/^\p{White_Space}*(?:#|$)/u.test(text)) continue;
    return !/^(?:\p{White_Space}|-)/u.test(text);
  }
  return true;
}

/**
 * Whether YAML cannot read a block item as written: it starts with `#` (a comment, read as
 * null), with a reserved indicator (`@`, `` ` ``, `%`), or with a quote that does not close —
 * a closed quote may be followed by a comment.
 */
function blockItemUnreadable(raw: string): boolean {
  if (/^[#@`%]/.test(raw)) return true;
  if (raw.startsWith('"'))
    return !/^"(?:[^"\\]|\\.)*"(?:[ \t]+#.*)?$/.test(raw);
  if (raw.startsWith("'")) return !/^'(?:[^']|'')*'(?:[ \t]+#.*)?$/.test(raw);
  return false;
}

/**
 * Whether YAML reads `raw`, unquoted, as one scalar in a flow list: it does not start with an
 * indicator, `- `, `? ` or `: `, and holds no `: ` (a mapping), no ` #` (a comment, which runs
 * past the `]`) and no `,[]{}`.
 */
function readsPlainInFlow(raw: string): boolean {
  if (/^[#&*!|>'"%@`,[\]{}]/.test(raw)) return false;
  if (/^[-?:](?:\s|$)/.test(raw)) return false;
  if (/:(?:\s|$)/.test(raw) || /\s#/.test(raw)) return false;
  return !/[,[\]{}]/.test(raw);
}

/**
 * A flow list's items, split at the commas that are not inside a quoted item, each without
 * the whitespace around it; empty items dropped. `unclosed` when a quote never closes, `nested`
 * when an unquoted `[` or `{` opens a collection inside the list.
 */
function splitFlowItems(inner: string): {
  items: string[];
  nested: boolean;
  unclosed: boolean;
} {
  const items: string[] = [];
  let current = "";
  let quote: null | string = null;
  let nested = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      current += c;
      if (quote === '"' && c === "\\" && i + 1 < inner.length) {
        current += inner[++i];
      } else if (c === quote) {
        if (quote === "'" && inner[i + 1] === "'") current += inner[++i];
        else quote = null;
      }
    } else if (c === ",") {
      items.push(current);
      current = "";
    } else {
      // A quote opens a quoted scalar only at the start of an item.
      if ((c === '"' || c === "'") && whitespaceTrim(current) === "") quote = c;
      else if (c === "[" || c === "{") nested = true;
      current += c;
    }
  }
  items.push(current);
  return {
    items: items.map(whitespaceTrim).filter(Boolean),
    nested,
    unclosed: quote !== null,
  };
}

/** `yaml` cut at `\n`, each line losing one `\r` before its `\n` — Rust's `str::lines`. */
function splitLines(yaml: string): Line[] {
  const lines: Line[] = [];
  for (let start = 0; ;) {
    const nl = yaml.indexOf("\n", start);
    if (nl === -1) {
      lines.push({ break: "", start, text: yaml.slice(start) });
      return lines;
    }
    const cr = nl > start && yaml[nl - 1] === "\r";
    lines.push({
      break: cr ? "\r\n" : "\n",
      start,
      text: yaml.slice(start, cr ? nl - 1 : nl),
    });
    start = nl + 1;
  }
}

/**
 * An item's text without its quotes, taken off as the backend's front-matter tag reader takes
 * them (`extract_frontmatter_tags`): every `"` at either end, then every `'`. No escape is read.
 */
function unquote(raw: string): string {
  return raw.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
}

/** `s` without Unicode whitespace at either end — Rust's `str::trim`, not JavaScript's. */
function whitespaceTrim(s: string): string {
  return s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}
