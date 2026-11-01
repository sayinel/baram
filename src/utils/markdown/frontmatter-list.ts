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

import { endsInOpenValue } from "./frontmatter-fields";
import { yamlString } from "./yaml-scalar";

/** One list field as the YAML spells it. */
export interface FrontmatterList {
  /**
   * Whether a writer may rewrite the list in place. Inline: nothing but blanks and a comment
   * follows `]`, every quote closes, no item opens a nested `[` or `{`. Block: past the last
   * item, and any blank or comment lines after it, the next line is neither indented nor a
   * `-` line — it is not a continuation of an item, nor an item after a gap; and every `-` is
   * followed by a space or a tab, as YAML needs to read an entry (to YAML `-` + U+00A0 begins
   * text, and yaml 2.9.1 and js-yaml 4.3.2 reject that text once an item line follows it).
   */
  complete: boolean;
  /** Offset just past the list: its `]`, or the end of its last line (before that line's break). */
  end: number;
  /** `inline` — `field: [a, b]`; `block` — `field:` and then `- a` lines, or none. */
  form: "block" | "inline";
  items: FrontmatterListItem[];
  /** The key line up to and including its colon — `tags:`, `Tags :`. */
  key: string;
  /**
   * Block form: every line read as part of the list, as written — an item, or a `-` with no
   * item after it: blank, or only a comment.
   */
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
  /**
   * The item as written, quotes included, without the whitespace around it — and, in block
   * form, without the comment after it (`blockItem`).
   */
  raw: string;
  /** What the item says: `raw` without its quotes, as the readers take them off. */
  value: string;
}

/** A line of a block list: the line break before it and its text, with the item it holds. */
export interface FrontmatterListLine {
  item?: FrontmatterListItem;
  /** The text in front of the item, `  - `, whether or not the line holds one. */
  lead: string;
  sep: string;
  text: string;
}

/**
 * Appends `line` to the front matter `yaml` at column 0, after everything in it — a key put
 * after the first line could land inside that line's value (a block list, a `|` scalar). A
 * front matter that ended with a line break still does. A front matter whose last value holds
 * a quote or flow bracket that never closes (`endsInOpenValue`) is returned unchanged: the line
 * would be read as part of that value. Every writer that appends goes through here:
 * `writeFrontmatterList` for a key it does not find (the tag bar, the Properties panel's
 * chips), `addYamlProperty` (the panel's Add property) and `setYamlPropertyValue` for a key not
 * there. The tag bar and the panel's add say why nothing was written.
 */
export function appendFrontmatterLine(yaml: string, line: string): string {
  if (yaml === "") return line;
  if (endsInOpenValue(yaml)) return yaml;
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
 * indicator (`@`, `` ` ``), the directive indicator `%` or a quote that does not close. Then its
 * value is written as a new one.
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
 * (`White_Space`, as Rust's `char::is_whitespace`). A block item is its line's text without
 * the comment YAML reads after it, and a line that is only a comment holds no item — YAML's
 * reading where the line's whitespace is spaces and tabs, but for an item that starts with `#`
 * and a name, which YAML reads as a comment and the readers keep on purpose (`- #solo # memo`
 * is `#solo`); `blockItem` says both.
 * An item's value is its text less every `"` at either end, then every `'` — no escape is
 * read.
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
        const raw = blockItem(item[2]);
        const read = raw ? { lead: item[1], raw, value: unquote(raw) } : null;
        if (read) block.items.push(read);
        block.lines.push({
          ...(read && { item: read }),
          lead: item[1],
          sep: lines[i - 1].break,
          text,
        });
        if (!/-[ \t]/.test(item[1])) block.complete = false;
        block.end = start + text.length;
        continue;
      }
      block.complete &&= blockEndsAt(lines, i);
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
 * cannot read is respelled (`listItemSpelling`) — in a block list, keeping its comment and the
 * spaces and tabs before that, and nothing else on its line: no other whitespace and no lone
 * `\r`, which YAML (yaml 2.9.1, for the `\r`) does not take after a closing quote.
 * A name no item has is added at the end, in the
 * list's form and lead, with its line break. A block list this edit leaves with nothing is
 * written `field: []`.
 * In a block list the lines an edit does not touch stay byte for byte (but for a lone `\r` that
 * ends the last line, which goes when lines are added after it), so writing back the names
 * the list already has changes nothing but the respelling of items YAML cannot read. An inline
 * list is rewritten whole, its items joined by `, ` between the brackets — `[a,b]` and
 * `[ a , b ]` come back `[a, b]`, whatever the edit; what follows the `]` stays.
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

  // The first item's lead, or the first line's when no line holds an item (`- # todo`), with
  // any whitespace in it but a space or a tab made a space: YAML reads `- ` + U+00A0 + `z` as
  // the item U+00A0 + `z`, where the reader reads `z`.
  const lead = (list.items[0]?.lead ?? list.lines[0]?.lead ?? "  - ").replace(
    /(?![ \t])\p{White_Space}/gu,
    " ",
  );
  const kept = list.lines
    .filter((line) => !line.item || stays(line.item))
    .map(({ item, sep, text }) => {
      if (!item || !blockItemUnreadable(item.raw)) return `${sep}${text}`;
      // What follows the item on its line is whitespace and then, maybe, its comment. The
      // comment stays, set off by the spaces and tabs before it, and nothing else does: after
      // the closing quote a respelling may add, YAML takes no other whitespace, and yaml 2.9.1
      // no lone `\r` (a line ends with one where the note has `\r\r\n`); the reader names
      // the item without either. `raw` starts right after `lead` (`blockItem`), so the first
      // `#` after it starts the comment.
      const after = text.slice(item.lead!.length + item.raw.length);
      const at = after.indexOf("#");
      const comment =
        at < 0
          ? ""
          : after.slice(0, at).replace(/[^ \t]/g, "") + after.slice(at);
      return `${sep}${item.lead}${listItemSpelling(item.value, false)}${comment}`;
    });
  if (kept.length + added.length === 0) {
    // An empty `field:` stays as it is; one emptied by this edit becomes `field: []`.
    if (list.lines.length === 0) return yaml;
    return `${yaml.slice(0, list.start)}${list.key} []${yaml.slice(list.end)}`;
  }
  const appended = added.map(
    (name) => `${list.newline}${lead}${listItemSpelling(name, false)}`,
  );
  // A lone `\r` that ends the list's last line (`\r\r\n` in the note, or a front matter that
  // ends `\r\r\n---`: what the callers hand over stops before the fence's `\r?\n`) goes when
  // lines are added after it.
  // Kept, it would come before the added lines' break, or last after them; yaml 2.9.1 rejects
  // a closing quote followed by a lone `\r`, either way.
  let body = kept.join("");
  if (appended.length > 0 && body.endsWith("\r")) body = body.slice(0, -1);
  return (
    yaml.slice(0, list.open) + body + appended.join("") + yaml.slice(list.end)
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

/**
 * A closed double-quoted scalar, where `\` escapes the next character. Only that the scalar
 * closes is judged, not that YAML takes its escapes: `"a\xb"`, or `\` before U+2028, U+2029
 * or a lone `\r`, closes here, where yaml 2.9.1 rejects the escape (js-yaml 4.3.2 rejects the
 * first three and reads `\` + `\r` as an escaped line break). Such an item is kept as
 * written: the text was unreadable already.
 */
const DOUBLE_QUOTED_SCALAR = String.raw`"(?:[^"\\]|\\[^\n])*"`;
/** A closed single-quoted scalar, where `''` is a quote. */
const SINGLE_QUOTED_SCALAR = String.raw`'(?:[^']|'')*'`;

const DOUBLE_QUOTED = new RegExp(`^${DOUBLE_QUOTED_SCALAR}$`);
const SINGLE_QUOTED = new RegExp(`^${SINGLE_QUOTED_SCALAR}$`);

/**
 * A block item that is one quoted scalar and then nothing, or a `#` comment set off by spaces
 * or tabs. Group 1 is the scalar. Its source is the text of the backend's
 * `FM_TAGS_QUOTED_ITEM_RE`.
 */
const QUOTED_ITEM = new RegExp(
  String.raw`^(${DOUBLE_QUOTED_SCALAR}|${SINGLE_QUOTED_SCALAR})(?:[ \t]+#[^\n]*)?$`,
);

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
 * The item of a block list line, `rest` being the line's text after its dash and the whitespace
 * after that, without the comment YAML reads after it; `""` when the line holds only a comment.
 * The backend's `block_item` reads the same: the text less the whitespace at its ends is read —
 * - a quoted item (`QUOTED_ITEM`) followed by nothing or by spaces or tabs and a `#` comment is
 *   the quoted part — `"#solo"   # keep me` is `"#solo"`, `"q # in"` all of it;
 * - an item that starts with a quote otherwise — one that never closes, or text after the
 *   closing quote that is not a comment — is the whole text, `#`s and all;
 * - `#`s and then whitespace or nothing are a comment (`- # memo`, `- ## memo`): no item. YAML
 *   reads a comment there, the `#` set off by the space or tab after the dash, and no name the
 *   body can spell begins with whitespace (`isBodyTagName`);
 * - any other item ends before the first `#` that follows a space or a tab, less the
 *   whitespace before that: `plain # memo` is `plain`; `a#b` is whole, and so is `a`, then
 *   U+3000, then `# b` — U+3000 is whitespace, but not a space to YAML. An item whose `#`s are
 *   followed by any other character is read by this rule too (`#solo # memo` is `#solo`), as
 *   `- #solo` is, which YAML reads as a comment.
 *
 * Where that whitespace is not a space or a tab this differs from YAML on purpose: the dash's
 * whitespace (the item pattern of `readFrontmatterLists`) and the trims take any Unicode
 * whitespace, as the readers always have done to name an item, but YAML sets nothing off with
 * it. An indented `-` + U+00A0 + `# memo` and `- ` + U+3000 + `#` hold no item here, where
 * YAML reads the strings `-` + U+00A0 + `# memo` (the key's whole value; at the key's own
 * indentation both packages reject the text) and U+3000 + `#`; `a` + U+00A0 + ` # c` is `a`,
 * where YAML reads `a` + U+00A0. A writer does not rely on it (`writeFrontmatterList`).
 *
 * The item is the start of `rest` (whose first character is not whitespace when it holds an
 * item: the dash's whitespace is all in front of it).
 */
function blockItem(rest: string): string {
  const text = whitespaceTrim(rest);
  const quoted = QUOTED_ITEM.exec(text);
  if (quoted) return quoted[1];
  if (text.startsWith('"') || text.startsWith("'")) return text;
  if (/^#+(?:\p{White_Space}|$)/u.test(text)) return "";
  const comment = /[ \t]#/.exec(text);
  return comment ? whitespaceTrim(text.slice(0, comment.index)) : text;
}

/**
 * Whether YAML cannot read a block item as written: it starts with `#` (a comment, read as
 * null), with a reserved indicator (`@`, `` ` ``) or the directive indicator `%` — none of
 * which may begin a plain scalar — or with a quote that does not close at its end. The comment
 * after an item is not part of it (`blockItem`).
 */
function blockItemUnreadable(raw: string): boolean {
  if (/^[#@`%]/.test(raw)) return true;
  if (raw.startsWith('"')) return !DOUBLE_QUOTED.test(raw);
  if (raw.startsWith("'")) return !SINGLE_QUOTED.test(raw);
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
