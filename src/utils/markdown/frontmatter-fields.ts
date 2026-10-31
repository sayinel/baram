// §72 The top-level fields of a front matter, read line by line: where each key's value starts
// and ends. Its own module so that the list writer's append (`appendFrontmatterLine`) and the
// Properties panel (`yaml-properties.ts`) read the same fields.

export interface Field {
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
 * A top-level key line: the key at column 0 — plain, or quoted — and its colon, followed by
 * whitespace or the end of the line.
 */
const KEY_LINE =
  /^((?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#\-"'?:][^\n]*?)[ \t]*:)(?:[ \t]+([^\n]*)|[ \t]*)$/;

/**
 * Whether the last field of `yaml` holds a quote or flow bracket that never closes
 * (`opensPastItsLine`): the field runs to the end of the front matter, and a line appended
 * after it would be read as part of its value.
 */
export function endsInOpenValue(yaml: string): boolean {
  return walkFields(yaml).openAtEnd;
}

/**
 * Whether a value's quote or flow bracket is still open at the end of `value`: it starts (after
 * any anchor and tag) with a quote or with `[` or `{`, and that quote does not close or those
 * brackets do not balance. Quotes close as `quotesCloseWithin` (`yaml-properties.ts`) judges them — `''` inside a
 * single-quoted scalar, `\` escaping the next character inside a double-quoted one — and open
 * only where a node starts: at the value's start, or after `[`, `{`, `,` or `:`. Outside quotes
 * a `#` at the start or after whitespace begins a comment, to the end of its line. A plain
 * value never is: one that runs on needs an indented line, which `topLevelFields` counts.
 */
function opensPastItsLine(value: string): boolean {
  const rest = value.replace(/^(?:[&!]\S*\s+)*/, "");
  if (!/^['"[{]/.test(rest)) return false;
  let depth = 0;
  let quote: null | string = null;
  let previous = "";
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (quote === "'") {
      if (c === "'") {
        if (rest[i + 1] === "'") i++;
        else quote = null;
      }
      continue;
    }
    if (quote === '"') {
      if (c === "\\") i++;
      else if (c === '"') quote = null;
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(rest[i - 1]))) {
      const lineEnd = rest.indexOf("\n", i);
      if (lineEnd === -1) break;
      i = lineEnd;
      continue;
    }
    if ((c === "'" || c === '"') && /^[[{,:]?$/.test(previous)) quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    if (!/\s/.test(c)) previous = c;
  }
  return quote !== null || depth > 0;
}

/**
 * The top-level fields of `yaml`, in order. A field runs from its key line through the last
 * line under it that is indented or a `-` item; blank and comment lines count only when such a
 * line follows them, and the next column-0 line that is neither ends it. A value whose quote or
 * flow bracket does not close on the key's line (`opensPastItsLine`) also takes every line up
 * to the one that closes it, whatever those lines hold: `k: {a: 1,` then `b: 2}` is one field,
 * as js-yaml reads it (yaml 2.9.1 reports an error), not a field `b` holding `2}`.
 */
export function topLevelFields(yaml: string): Field[] {
  return walkFields(yaml).fields;
}

/** `topLevelFields`, and whether the last field's quote or bracket is still open at the end. */
function walkFields(yaml: string): { fields: Field[]; openAtEnd: boolean } {
  const fields: Field[] = [];
  let field: Field | null = null;
  // The value so far of a field whose quote or bracket is still open.
  let open: null | string = null;
  let start = 0;
  for (const piece of yaml.split("\n")) {
    const text = piece.endsWith("\r") ? piece.slice(0, -1) : piece;
    const lineStart = start;
    start += piece.length + 1;
    if (field && open !== null) {
      field.continued = true;
      field.end = lineStart + text.length;
      open = opensPastItsLine(`${open}\n${text}`) ? `${open}\n${text}` : null;
      continue;
    }
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
      if (opensPastItsLine(field.value)) open = field.value;
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
  return { fields, openAtEnd: open !== null };
}
