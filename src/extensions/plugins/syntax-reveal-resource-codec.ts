// §5.1 + §3.3 Syntax Reveal — shared resource codec for reveal-mode
// `[label](destination "title")` / `![label](destination "title")` text.
//
// §384 fix (B2): both collapse implementations matched destinations with
// `\S+?`, so a destination containing whitespace/control chars — e.g.
// href="a b" parsed from `[x](<a b>)` — could never collapse back: expansion
// printed it raw (`[x](a b)`), collapse's `\S+?` failed to match it, and the
// literal delimiters were left behind permanently (reproduced identically for
// media, including through the video classifier: `![x](<clip one.mp4>)`).
// This is the ONE shared serialize/parse pair for link+image(media) reveal
// text, so expansion and BOTH collapse implementations agree on exactly one
// grammar. Escaping/angle-bracket rules mirror mdast-util-to-markdown's
// link/image handler (node_modules/mdast-util-to-markdown/lib/handle/link.js
// + lib/unsafe.js) so what gets typed here round-trips through the real
// markdown serializer identically.

export interface RevealResource {
  destination: string;
  kind: RevealResourceKind;
  /** Link text (kind "link") or alt text (kind "image") — unescaped. */
  label: string;
  title: null | string;
}

export type RevealResourceKind = "image" | "link";

// Characters escaped per construct, per mdast-util-to-markdown/lib/unsafe.js:
// `label`/`reference` → `[` and `]`; `destinationLiteral` (angle form) → `<`
// and `>` (both — an unescaped `<` inside angle brackets is invalid
// CommonMark); `destinationRaw` → `(` and `)`; `titleQuote` → `"`.
const LABEL_SPECIALS = new Set(["[", "]"]);
const ANGLE_DEST_SPECIALS = new Set(["<", ">"]);
const RAW_DEST_SPECIALS = new Set(["(", ")"]);
const TITLE_SPECIALS = new Set(['"']);

/** ASCII whitespace or control chars — forces the angle-bracket destination form. */
const NEEDS_ANGLE_RE = /[\0-\x20\x7f]/;

function escapeSpecials(text: string, specials: ReadonlySet<string>): string {
  let out = "";
  for (const ch of text) {
    if (ch === "\\" || specials.has(ch)) out += "\\";
    out += ch;
  }
  return out;
}

/** Inverse of escapeSpecials: a backslash escapes whatever character follows it. */
export function serializeRevealResource(resource: RevealResource): string {
  const { kind, label, destination, title } = resource;
  const prefix = kind === "image" ? "!" : "";
  const labelText = escapeSpecials(label, LABEL_SPECIALS);
  const destText = serializeDestination(destination, title);
  const titleText = title ? ` "${escapeSpecials(title, TITLE_SPECIALS)}"` : "";
  return `${prefix}[${labelText}](${destText}${titleText})`;
}

function serializeDestination(
  destination: string,
  title: null | string,
): string {
  // Angle form whenever: the destination is empty but a title follows (bare
  // `()` can't be told apart from "no title" otherwise), OR the destination
  // contains ASCII whitespace/control chars (a raw destination cannot).
  if ((destination === "" && !!title) || NEEDS_ANGLE_RE.test(destination)) {
    return `<${escapeSpecials(destination, ANGLE_DEST_SPECIALS)}>`;
  }
  return escapeSpecials(destination, RAW_DEST_SPECIALS);
}

function unescapeSpecials(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length) {
      out += text[++i];
    } else {
      out += text[i];
    }
  }
  return out;
}

// Content patterns mirror the escape sets above exactly, so parse is
// serialize's inverse: `\\.` (escaped-anything, consumed as one unit) or any
// char outside the construct's own delimiters.
const LABEL_CONTENT = String.raw`(?:\\.|[^\]\\])*`;
const ANGLE_DEST_CONTENT = String.raw`(?:\\.|[^<>\\])*`;
// A raw (non-angle) destination cannot contain unescaped whitespace or
// parens — that restriction is exactly why whitespace forces the angle form.
const RAW_DEST_CONTENT = String.raw`(?:\\.|[^\s()\\])*`;
const TITLE_CONTENT = String.raw`(?:\\.|[^"\\])*`;

const REVEAL_RESOURCE_RE = new RegExp(
  `^(!?)\\[(${LABEL_CONTENT})\\]\\(` +
    `(?:<(${ANGLE_DEST_CONTENT})>|(${RAW_DEST_CONTENT}))` +
    `(?:\\s+"(${TITLE_CONTENT})")?\\)$`,
);

export function parseRevealResource(text: string): null | RevealResource {
  const match = REVEAL_RESOURCE_RE.exec(text);
  if (!match) return null;

  const [, bang, label, angleDest, rawDest, title] = match;
  const destination = unescapeSpecials(angleDest ?? rawDest ?? "");

  return {
    kind: bang ? "image" : "link",
    label: unescapeSpecials(label),
    destination,
    title: title !== undefined ? unescapeSpecials(title) : null,
  };
}
