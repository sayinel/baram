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
//
// §384 fix (R3-1) — SCOPE BOUNDARY: a destination beginning with `<` (e.g.
// `href: "<a>"`) is ALSO lossy through `mdast-util-to-markdown` itself —
// confirmed directly against that library, it writes `href="<a>"` out as
// `[x](<a>)` with no escaping, the exact same ambiguous spelling this file's
// `serializeDestination` used to produce. That is a pre-existing upstream
// defect in the CANONICAL markdown serializer (src/pipeline/pm-to-md.ts →
// mdast-util-to-markdown), independent of syntax reveal, and is tracked as a
// separate follow-up issue — NOT fixed here. This file's contract is narrower
// and self-contained: `serializeRevealResource`/`parseRevealResource` are
// each other's exact inverse for reveal-mode expand/collapse. Do not "fix"
// the upstream spelling by editing pm-to-md.ts or a transformer from this
// commit — that is out of scope for what this codec owns.

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

/**
 * §384 fix (F1 round 2): callers that stashed the true label boundary at
 * expand time (see `ExpandedRange.labelEnd`) pass it back in here as
 * `labelEnd` — the index, in `text`, of the `]` that opens
 * `](destination…)`. When given, the label is exactly `text.slice(prefixLen,
 * labelEnd)` and only the destination/title grammar is matched against the
 * remaining tail — no searching. This is what makes the split unambiguous:
 * see `parseRevealResource`'s doc comment for why text-only search cannot be.
 */
export interface ParseRevealResourceOptions {
  /** Exact label boundary stashed at expand time — resolves the split
   *  without any search (the only path production uses). */
  labelEnd?: number;
  /**
   * §384 (impl review r5): which label grammar the text was written in. The
   * same bytes can be BOTH the serializer's output for one resource and live
   * unescaped label text for another (`[x](< a](b>)` is label "x" /
   * destination " a](b" when serialized, but label "x](< a" / destination
   * "b>" as live text) — no parser can recover that provenance from the
   * string, so the caller states it. `"serialized"` (default) uses the
   * escaped-label grammar `serializeRevealResource` emits, making
   * `parse(serialize(x)) === x` for every resource; `"live"` uses the
   * lenient greedy search for text whose label is unescaped document text.
   */
  labelGrammar?: "live" | "serialized";
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

/**
 * §384 fix (F1 round 2): the length `label` occupies once escaped exactly as
 * `serializeRevealResource` writes it (see `escapeSpecials`/`LABEL_SPECIALS`
 * above). `expandMediaAtom` uses this to compute the media alt's doc-absolute
 * `ExpandedRange.labelEnd` — the alt text is written into the inserted text
 * node literally (unlike a link label, which stays live, unescaped doc text —
 * see expandLink), so its escaped length is exactly what's needed to locate
 * the `]` that follows it.
 */
export function escapedLabelLength(label: string): number {
  return escapeSpecials(label, LABEL_SPECIALS).length;
}

// §384 fix (R3-1) — CRITICAL: a destination beginning with `<` must ALWAYS
// take the angle form, even though it contains no ASCII whitespace/control
// char. The raw form only escapes `(`/`)` (RAW_DEST_SPECIALS) — a leading `<`
// passes through untouched — so `destination: "<a>"` serialized raw as
// `[x](<a>)`, and the parser's tail grammar tries the angle branch FIRST
// (`<(${ANGLE_DEST_CONTENT})>|(...)`), matching that leading `<...>` as if it
// were the wrapper it never was: destination "a", the enclosing `<`/`>`
// silently eaten. Same failure for `destination: "<>"` → `[x](<>)` → parsed
// destination "" (indistinguishable from a truly empty one). Forcing angle
// form here makes the destination's OWN `<`/`>` get escaped
// (ANGLE_DEST_SPECIALS), which is exactly what removes the ambiguity: the
// parser then sees an ESCAPED `\<`/`\>` inside the wrapper, not a raw one it
// could mistake for the wrapper's own delimiters. A one-million-case
// randomized probe (serialize → parse → compare) found 431 failures without
// this condition and zero with it.
function serializeDestination(
  destination: string,
  title: null | string,
): string {
  // Angle form whenever: the destination is empty but a title follows (bare
  // `()` can't be told apart from "no title" otherwise — including an empty
  // *present* title, §384 fix (F4): `title !== null`, not truthiness), OR the
  // destination contains ASCII whitespace/control chars (a raw destination
  // cannot), OR the destination starts with `<` (§384 fix R3-1 above).
  if (
    (destination === "" && title !== null) ||
    NEEDS_ANGLE_RE.test(destination) ||
    destination.startsWith("<")
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
//
// §384 fix (F1 round 2): that "longest label with a valid tail" heuristic is
// not just imprecise for a label that self-embeds `](destination)` — it is
// WRONG whenever the DESTINATION itself contains a literal `](` and would
// also complete the destination/title/`)` grammar starting from THAT split.
// Angle form only escapes `<`/`>`, so a destination like " a](b" (needs angle
// because of the leading space) serializes to `[x](< a](b>)`, and backtracking
// finds the destination's OWN embedded `](` first — it's the LONGEST label
// with a tail that validates — misreading it as label "x](< a" / destination
// "b>" instead of the real label "x" / destination " a](b". Every current
// production caller sidesteps this: they hold the stashed, doc-position-
// mapped label length from expand time (`ExpandedRange.labelEnd`) and pass it
// as `labelEnd` below, which resolves the split exactly instead of searching
// for it. `REVEAL_RESOURCE_RE`'s search remains only for callers with no such
// stash (documented on `parseRevealResource` below).
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

// The `](destination "title")` grammar, shared verbatim by both regexes
// below so there's exactly one place that defines it — see this file's
// opening comment on why expansion and both collapse implementations must
// agree on a single grammar. Capture groups: 1 = angle destination, 2 = raw
// destination, 3 = title.
const RESOURCE_TAIL = String.raw`\]\((?:<(${ANGLE_DEST_CONTENT})>|(${RAW_DEST_CONTENT}))(?:\s+"(${TITLE_CONTENT})")?\)$`;

// §384 (impl review r4/r5): two label grammars, chosen by the caller's
// declared provenance (`labelGrammar`), never by trying one then the other —
// the same bytes can satisfy both with different splits, so a fallback
// order would silently pick a wrong interpretation. STRICT is the grammar
// `serializeRevealResource` emits (a label's own `]` is always escaped), so
// the split is unambiguous and `parse(serialize(x))` holds for every
// resource the serializer can produce. LENIENT is the greedy search for live
// unescaped label text, with its documented ambiguity.
const LABEL_CONTENT_STRICT = String.raw`(?:\\.|[^\]\\])*`;
const REVEAL_RESOURCE_STRICT_RE = new RegExp(
  `^(!?)\\[(${LABEL_CONTENT_STRICT})${RESOURCE_TAIL}`,
);
const REVEAL_RESOURCE_RE = new RegExp(
  `^(!?)\\[(${LABEL_CONTENT_LENIENT})${RESOURCE_TAIL}`,
);

// §384 fix (F1 round 2): the same tail grammar, anchored to start right at a
// KNOWN `](` — used by the `labelEnd`-aware path below, which already knows
// exactly where the label ends and only needs to validate what follows it.
// No label group, no search: `parseWithLabelEnd` slices the label itself
// directly from `labelEnd`.
const RESOURCE_TAIL_RE = new RegExp(`^${RESOURCE_TAIL}`);

/**
 * §384 fix (F1 round 2): resolve the split from a KNOWN label boundary
 * instead of searching for one — see `ParseRevealResourceOptions.labelEnd`.
 * `labelEnd` must be the exact index (in `text`) of the `]` that opens
 * `](destination…)`; anything else — including a `labelEnd` that WOULD have
 * been a valid split for a different (e.g. stale, since-edited) text — is
 * rejected outright with `null`. This never falls back to the ambiguous
 * `REVEAL_RESOURCE_RE` search: a bad stash must fail loudly, not silently
 * reopen the exact corruption this fix closes.
 */
function parseWithLabelEnd(
  text: string,
  labelEnd: number,
): null | ParsedRevealResource {
  const bang = text.startsWith("!") ? "!" : "";
  const prefixLen = bang.length + 1; // "[" or "!["
  if (
    labelEnd < prefixLen ||
    text[prefixLen - 1] !== "[" ||
    labelEnd + 1 >= text.length
  ) {
    return null;
  }

  const tail = text.slice(labelEnd);
  const tailMatch = RESOURCE_TAIL_RE.exec(tail);
  if (!tailMatch) return null;

  const [, angleDest, rawDest, title] = tailMatch;
  const label = text.slice(prefixLen, labelEnd);

  return {
    kind: bang ? "image" : "link",
    label: unescapeSpecials(label),
    destination: unescapeSpecials(angleDest ?? rawDest ?? ""),
    title: title !== undefined ? unescapeSpecials(title) : null,
    labelEnd,
  };
}

/**
 * Parse `[label](destination "title")` / `![label](destination "title")`
 * reveal text — the inverse of `serializeRevealResource`.
 *
 * Pass `opts.labelEnd` whenever the caller already knows the true label
 * boundary (every current production call site does — see
 * `ExpandedRange.labelEnd`, stashed at expand time and mapped through edits).
 * That resolves the split exactly instead of searching for it — see the
 * comment above `LABEL_CONTENT_LENIENT` for why a destination containing a
 * literal `](` otherwise makes the search resolvable but WRONG, not just
 * ambiguous.
 *
 * Without `opts.labelEnd` (legacy path — e.g. an external caller with no
 * stashed boundary), falls back to `REVEAL_RESOURCE_RE`'s greedy-then-
 * backtrack search, which keeps its pre-existing, documented ambiguity.
 */
export function parseRevealResource(
  text: string,
  opts?: ParseRevealResourceOptions,
): null | ParsedRevealResource {
  if (opts?.labelEnd !== undefined) {
    return parseWithLabelEnd(text, opts.labelEnd);
  }

  const match =
    opts?.labelGrammar === "live"
      ? REVEAL_RESOURCE_RE.exec(text)
      : REVEAL_RESOURCE_STRICT_RE.exec(text);
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
