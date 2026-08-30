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

/**
 * §384 fix (F1): parse also reports where the label ended in the SOURCE text
 * (the index of the `]` that opens `](destination…)`), so callers that need
 * to split live doc content around the label (both collapse implementations,
 * `computeContentLen`, `buildExpandedDecorations`) read it from the parser
 * instead of re-deriving it with their own `indexOf("](")`/`lastIndexOf`.
 * That independent re-derivation is exactly what broke: a link LABEL is live
 * doc text, never escaped on expand (see expandLink), so it can contain a
 * bare `]` the label grammar below now tolerates — but a callsite still
 * scanning for the FIRST `"]("` would split there instead of at the real
 * boundary the greedy-backtracking regex actually matched.
 */
export interface ParsedRevealResource extends RevealResource {
  labelEnd: number;
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
  // §384 fix (F4): `title !== null`, not truthiness — `title: ""` is a
  // present-but-empty title, distinct from `title: null` (no title at all).
  // Truthiness treated both as "no title", so `{ destination: "", title: "" }`
  // serialized to `[x]()` and parsed back as `{ destination: "", title: null }`
  // — not the declared type's inverse.
  const titleText =
    title !== null ? ` "${escapeSpecials(title, TITLE_SPECIALS)}"` : "";
  return `${prefix}[${labelText}](${destText}${titleText})`;
}

function serializeDestination(
  destination: string,
  title: null | string,
): string {
  // Angle form whenever: the destination is empty but a title follows (bare
  // `()` can't be told apart from "no title" otherwise — including an empty
  // *present* title, §384 fix (F4): `title !== null`, not truthiness), OR the
  // destination contains ASCII whitespace/control chars (a raw destination
  // cannot).
  if (
    (destination === "" && title !== null) ||
    NEEDS_ANGLE_RE.test(destination)
  ) {
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
// char outside the construct's own delimiters — EXCEPT the label, see below.
//
// §384 fix (F1): the label is matched leniently (`[\s\S]*`, not an
// escape-aware `(?:\\.|[^\]\\])*`) because a link label is live doc text
// that expandLink never escapes on expand — it can't: escaping would
// corrupt the label's own marks (see expandLink). So a label round-tripped
// from `[a\]b](u)` arrives here as the literal live text `a]b`, containing a
// bare `]`, and an escape-aware pattern can never consume past it.
//
// The regex engine's greedy-then-backtrack behavior turns that leniency into
// a search: it tries the LONGEST possible label first and backs off one
// character at a time until a literal `](` followed by a valid
// destination/title/`)` tail matches — i.e. "the last `](` whose suffix
// actually parses", not merely the last `](` in the string. That distinction
// matters because a raw or angle destination can itself contain a literal
// `](` (raw escapes `(`/`)` so cannot; angle only escapes `<`/`>` so can) —
// backtracking still lands on the correct split because the wrong,
// deeper-in-the-destination split's tail fails the destination/title/`)`
// grammar and gets rejected. A label that itself contains an unescaped,
// syntactically-complete `](destination)` tail is genuinely ambiguous with
// the real one — greedy matching resolves it to the LONGEST label with a
// valid tail (see the codec test's "ambiguous label" case), which need not
// be the split a human intended. That ambiguity predates this fix (the old
// strict grammar simply failed such labels outright instead); this fix does
// not resolve it, only the far more common bare-`]`-with-no-following-`(` case.
const LABEL_CONTENT_LENIENT = String.raw`[\s\S]*`;
const ANGLE_DEST_CONTENT = String.raw`(?:\\.|[^<>\\])*`;
// §384 fix (F2): exclude only the ASCII whitespace/control set that actually
// forces the angle form (NEEDS_ANGLE_RE above), not JS `\s` — which also
// matches Unicode whitespace (e.g. U+00A0 NBSP). serializeDestination only
// switches to angle form for the ASCII set, so a destination containing
// Unicode whitespace was serialized raw (e.g. `[x](a<NBSP>b)`) but rejected by
// this pattern — serialize and parse were not inverses over the full input
// domain the `destination: string` type actually admits.
const RAW_DEST_CONTENT = String.raw`(?:\\.|[^\0-\x20\x7f()\\])*`;
const TITLE_CONTENT = String.raw`(?:\\.|[^"\\])*`;

const REVEAL_RESOURCE_RE = new RegExp(
  `^(!?)\\[(${LABEL_CONTENT_LENIENT})\\]\\(` +
    `(?:<(${ANGLE_DEST_CONTENT})>|(${RAW_DEST_CONTENT}))` +
    `(?:\\s+"(${TITLE_CONTENT})")?\\)$`,
);

export function parseRevealResource(text: string): null | ParsedRevealResource {
  const match = REVEAL_RESOURCE_RE.exec(text);
  if (!match) return null;

  const [, bang, label, angleDest, rawDest, title] = match;
  const destination = unescapeSpecials(angleDest ?? rawDest ?? "");
  // §384 fix (F1): position of the `]` that closes the label in `text` —
  // callers use this instead of re-deriving it (e.g. via `indexOf("](")`),
  // which does not agree with the lenient label grammar above once a label
  // contains its own `]`/`(` characters. `label` here is still the RAW
  // matched (not yet unescaped) text, so its length is the source length.
  const labelEnd = bang.length + 1 + label.length;

  return {
    kind: bang ? "image" : "link",
    label: unescapeSpecials(label),
    destination,
    title: title !== undefined ? unescapeSpecials(title) : null,
    labelEnd,
  };
}
