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
 * A number, an ISO date or a boolean in the one spelling a YAML 1.2 reader gives back as the
 * same text: an integer without leading zeros, a decimal without trailing ones, `YYYY-MM-DD`,
 * `true`, `false`. A property written so keeps its type (`energy: 3`, `date: 2026-03-01`); one
 * written as `007` or `1.10` would read back as `7` and `1.1`, so it is quoted.
 */
const TYPED_PLAIN =
  /^(?:(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?|[0-9]{4}-[0-9]{2}-[0-9]{2}|true|false)$/;

/**
 * `value` written to be read back as that text by YAML and by the app's front-matter readers,
 * which take quotes off without reading escapes (`readFrontmatterLists`, the backend's tag
 * reader, `parseNoteTitleInfo`). Double quotes when the value needs no escape; else single
 * quotes when it holds no `'` and no line break; else a JSON string — YAML reads that back,
 * the quote-stripping readers do not.
 */
export function quotedScalar(value: string): string {
  const json = JSON.stringify(value);
  if (json === `"${value}"`) return json;
  if (!/['\n\r]/.test(value)) return `'${value}'`;
  return json;
}

/** A property's value as the Properties panel writes it: plain when YAML reads it back as that text. */
export function yamlPropertyValue(value: string): string {
  return SAFE_PLAIN.test(value) &&
    (!READS_AS_NON_STRING.test(value) || TYPED_PLAIN.test(value))
    ? value
    : quotedScalar(value);
}

/** A string value — a tag, a title — plain only when every YAML reader reads it as a string. */
export function yamlString(value: string): string {
  return SAFE_PLAIN.test(value) && !READS_AS_NON_STRING.test(value)
    ? value
    : quotedScalar(value);
}
