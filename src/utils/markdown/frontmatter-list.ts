// §56m A front-matter list field (`tags:`, `aliases:`) read item by item, and written back so
// YAML still reads it.
//
// The writers this serves — the tag bar, a fleeting note, a promoted note — used to join bare
// values with `, `. A value that starts with `#` then wrote `tags: [#solo]`: YAML reads a `#`
// after a space as a comment, so the flow list never closes and the whole front matter fails
// to parse. Items are therefore kept as they were written when YAML reads that spelling back
// as their value, and quoted when it would not.

/** One list field as the YAML spells it. */
export interface FrontmatterList {
  /** Offset just past the field: its `]`, or the end of its last item line. */
  end: number;
  /** `inline` — `field: [a, b]`; `block` — `field:` and then indented `- a` lines, or none. */
  form: "block" | "inline";
  items: FrontmatterListItem[];
  /** Offset of the field's key. */
  start: number;
}

export interface FrontmatterListItem {
  /** Block form: the text in front of the item on its line, `  - `. */
  lead?: string;
  /** The item as written, trimmed — quotes included. */
  raw: string;
  /** What the item says: `raw` without its quotes. */
  value: string;
}

/** A flow list `[a, b]` of the items' spellings (see {@link listItemSpelling}). */
export function flowList(items: (FrontmatterListItem | string)[]): string {
  return `[${items.map((i) => listItemSpelling(i, true)).join(", ")}]`;
}

/**
 * How to write an item into a flow (`flow`) or block list. A string is a new value: it stays
 * plain only when it is made of letters, digits and `_-./` and does not read as a number, a
 * date, a boolean or null — anything else is written double-quoted (a JSON string is a YAML
 * double-quoted scalar). An item that was read keeps its spelling when it is quoted already,
 * or when it is plain and YAML reads that plain spelling as its text; otherwise its value is
 * written as a new one.
 */
export function listItemSpelling(
  item: FrontmatterListItem | string,
  flow: boolean,
): string {
  if (typeof item === "string") {
    return SAFE_PLAIN.test(item) && !READS_AS_NON_STRING.test(item)
      ? item
      : JSON.stringify(item);
  }
  if (DOUBLE_QUOTED.test(item.raw) || SINGLE_QUOTED.test(item.raw)) {
    return item.raw;
  }
  return readsPlain(item.raw, flow)
    ? item.raw
    : listItemSpelling(item.value, flow);
}

/**
 * Reads `field` at the start of a line of `yaml` (front matter without its `---` fences), in
 * the two forms the app writes: `field: [a, b]` and `field:` followed by `- a` lines indented
 * under it. `field:` with nothing under it is an empty block list. Returns null when the field
 * is absent, and when it is present in a form this does not read — a scalar, an unindented
 * `- a` sequence, a mapping — so a caller does not write a list over the first line of it.
 */
export function readFrontmatterList(
  yaml: string,
  field: string,
): FrontmatterList | null {
  const inline = new RegExp(`^${field}:\\s*\\[([^\\]]*)\\]`, "m").exec(yaml);
  if (inline) {
    return {
      end: inline.index + inline[0].length,
      form: "inline",
      items: splitFlowItems(inline[1]).map((raw) => ({
        raw,
        value: unquote(raw),
      })),
      start: inline.index,
    };
  }

  const header = new RegExp(`^${field}:[ \\t]*(?=\\r?$)`, "m").exec(yaml);
  if (!header) return null;
  const items: FrontmatterListItem[] = [];
  let end = header.index + header[0].length;
  for (;;) {
    const lineStart = yaml.startsWith("\r\n", end)
      ? end + 2
      : yaml[end] === "\n"
        ? end + 1
        : -1;
    if (lineStart === -1) break;
    const lineEnd = yaml.indexOf("\n", lineStart);
    const line = yaml
      .slice(lineStart, lineEnd === -1 ? yaml.length : lineEnd)
      .replace(/\r$/, "");
    const item = /^([ \t]+-[ \t]+)(\S.*)$/.exec(line);
    if (!item) {
      // An indented line or an unindented `-` straight under the key is a value in a form
      // this does not read; anything else is the next key.
      if (items.length === 0 && /^(?:[ \t]+\S|-)/.test(line)) return null;
      break;
    }
    const raw = item[2].trim();
    items.push({ lead: item[1], raw, value: unquote(raw) });
    end = lineStart + line.length;
  }
  return { end, form: "block", items, start: header.index };
}

/** Plain letters, digits and `_-./`, not starting with a mark or punctuation. */
const SAFE_PLAIN = /^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_\-./]*$/u;

/**
 * Plain spellings YAML resolves to something other than a string: booleans and null (YAML 1.1's
 * words included), and anything that starts with a digit and could be read as a number or a
 * date (`2024`, `0x1F`, `1e5`, `2024-01-01`) — wider than the schemas, which costs only quotes.
 */
const READS_AS_NON_STRING =
  /^(?:true|false|yes|no|on|off|y|n|null|[0-9][0-9a-fA-FxXoO_.:+-]*)$/i;

const DOUBLE_QUOTED = /^"(?:[^"\\]|\\.)*"$/;
const SINGLE_QUOTED = /^'(?:[^']|'')*'$/;

/**
 * Whether YAML reads `raw`, unquoted, as one scalar with exactly this text: it does not start
 * with an indicator, `- `, `? ` or `: `, holds no `: ` (a mapping) and no ` #` (a comment), and
 * in a flow list no `,[]{}`.
 */
function readsPlain(raw: string, flow: boolean): boolean {
  if (/^[#&*!|>'"%@`,[\]{}]/.test(raw)) return false;
  if (/^[-?:](?:\s|$)/.test(raw)) return false;
  if (/:(?:\s|$)/.test(raw) || /\s#/.test(raw)) return false;
  return !(flow && /[,[\]{}]/.test(raw));
}

/** A flow list's items, split at the commas that are not inside a quoted item. */
function splitFlowItems(inner: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: null | string = null;
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
      out.push(current);
      current = "";
    } else {
      // A quote opens a quoted scalar only at the start of an item.
      if ((c === '"' || c === "'") && current.trim() === "") quote = c;
      current += c;
    }
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * An item's text without its quotes. A stray quote at either end of an unquoted item is
 * dropped, as the readers this replaced did.
 */
function unquote(raw: string): string {
  if (DOUBLE_QUOTED.test(raw)) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      // A YAML escape JSON does not know (`\x41`, `\ `): the text between the quotes.
      return raw.slice(1, -1);
    }
  }
  if (SINGLE_QUOTED.test(raw)) return raw.slice(1, -1).replace(/''/g, "'");
  return raw.replace(/^["']|["']$/g, "");
}
