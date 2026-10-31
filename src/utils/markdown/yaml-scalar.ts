// §56m How the app spells a value it writes into front matter, so YAML reads it back.
//
// One rule for every writer that puts a value it was given into front matter — a tag list's
// new item, a Zettel note's `title:`, a property the Properties panel edits — so that each
// stays plain where YAML reads the plain spelling as that text, and is quoted otherwise.

/**
 * Plain letters, digits and `_-./`, with single spaces between: no indicator at the start, no
 * `: ` or ` #`, nothing at either end that YAML would trim. YAML reads such a spelling as one
 * plain scalar holding exactly this text, in a flow list and in a block value alike.
 */
const SAFE_PLAIN = /^[\p{L}\p{N}_](?:[\p{L}\p{M}\p{N}_\-./]| (?! ))*(?<! )$/u;

/**
 * Plain spellings a YAML reader resolves to something other than a string: booleans and null —
 * `yes`·`no`·`on`·`off`·`y`·`n` included, which only a YAML 1.1 reader (js-yaml before 4,
 * PyYAML) takes for booleans — and anything that starts with a digit and could be read as a
 * number or a date (`2024`, `0x1F`, `1e5`, `2024-01-01`). Wider than any one schema, which
 * costs only quotes.
 */
const READS_AS_NON_STRING =
  /^(?:true|false|yes|no|on|off|y|n|null|[0-9][0-9a-fA-FxXoO_.:+-]*)$/i;

/**
 * A number or a boolean in the one spelling a YAML 1.2 reader gives back as the same text: an
 * integer without leading zeros, a decimal without trailing zeros, `true`, `false`. A property
 * written so keeps its type (`energy: 3`); one written as `007` or `1.10` would read back as
 * `7` and `1.1`, so it is quoted. A date is `isCalendarDate`.
 */
const TYPED_PLAIN = /^(?:(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?|true|false)$/;

/**
 * The kinds the YAML 1.2 core schema resolves a plain scalar to (YAML 1.2.2, §10.3.2 Tag
 * Resolution): null, a boolean, an integer or a float. The regular expressions are the
 * schema's own, written out.
 */
const CORE_NULL = /^(?:null|Null|NULL|~|)$/;
const CORE_BOOL = /^(?:true|True|TRUE|false|False|FALSE)$/;
const CORE_INT = /^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$/;
const CORE_FLOAT =
  /^(?:[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;

/**
 * What the YAML 1.2 core schema reads a plain spelling as (§10.3.2): `null` (empty, `~`,
 * `null` in its three cases), `bool`, `number` (an integer or a float — one kind here, as every
 * reader of a property's value takes both as a number), or `string`.
 */
export function coreScalarKind(
  plain: string,
): "bool" | "null" | "number" | "string" {
  if (CORE_NULL.test(plain)) return "null";
  if (CORE_BOOL.test(plain)) return "bool";
  if (CORE_INT.test(plain) || CORE_FLOAT.test(plain)) return "number";
  return "string";
}

/**
 * `value` written to be read back as that text by YAML and by the app's front-matter readers,
 * which take quotes off without reading escapes (`readFrontmatterLists`, the backend's tag
 * reader, `parseNoteTitleInfo`). Double quotes when the value needs no escape; else single
 * quotes when it holds no `'`, no line break and no character outside YAML's printable set
 * (`hasNonPrintable`), which a single-quoted scalar cannot hold; else a JSON string, whose
 * escapes YAML reads and the quote-stripping readers do not. Those readers also take every
 * `'` off either end, so a value that starts or ends with one (`'q`, `q'`) reads back as `q`
 * there, whatever the quotes.
 */
export function quotedScalar(value: string): string {
  const json = JSON.stringify(value);
  if (json === `"${value}"`) return json;
  if (!/['\n\r]/.test(value) && !hasNonPrintable(value)) {
    return `'${value}'`;
  }
  return json;
}

/**
 * Whether `value` holds a character outside YAML's printable set (`c-printable`, YAML 1.2.2,
 * §5.1), which a single-quoted scalar cannot hold: a C0 control but tab, line feed and carriage
 * return; DEL; a C1 control but NEL; a lone surrogate; U+FFFE or U+FFFF.
 */
function hasNonPrintable(value: string): boolean {
  for (const c of value) {
    const cp = c.codePointAt(0)!;
    if (
      (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) ||
      (cp >= 0x7f && cp <= 0x9f && cp !== 0x85) ||
      (cp >= 0xd800 && cp <= 0xdfff) ||
      cp === 0xfffe ||
      cp === 0xffff
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether `value` is `YYYY-MM-DD` naming a day the calendar has (`2024-02-29`, not
 * `2023-02-29` or `2026-13-45`).
 */
export function isCalendarDate(value: string): boolean {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * A property's value as the Properties panel writes it: plain when YAML reads it back as that
 * text — a number or boolean in its canonical spelling (`TYPED_PLAIN`) or a real calendar date
 * keeps its type — and quoted otherwise.
 */
export function yamlPropertyValue(value: string): string {
  return SAFE_PLAIN.test(value) &&
    (!READS_AS_NON_STRING.test(value) ||
      TYPED_PLAIN.test(value) ||
      isCalendarDate(value))
    ? value
    : quotedScalar(value);
}

/** A string value — a tag, a title — plain only when every YAML reader reads it as a string. */
export function yamlString(value: string): string {
  return SAFE_PLAIN.test(value) && !READS_AS_NON_STRING.test(value)
    ? value
    : quotedScalar(value);
}
