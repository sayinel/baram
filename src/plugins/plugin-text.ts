// §260 — plugin-supplied text on its way into the app's own chrome.
//
// Moved out of `sandbox/host-ui-bridge` in Phase 4c, when the settings pane became the
// second surface that renders author-controlled text (a `label` from the manifest). The
// rule has to be ONE implementation: it is the kind of thing a second copy gets subtly
// wrong, and the ranges below each carry a reason that would not survive being retyped.
// Kept tier-agnostic — the manifest is author-controlled in both tiers — so it must not
// pull in a store or a bridge.

/**
 * Make plugin-supplied text safe to render as a single line.
 *
 * Control characters go first: a newline in a status-bar item breaks the bar's layout,
 * and a bidi override can reorder what the user reads. Truncation happens on the
 * stripped string so the cap describes what is actually shown.
 */
export function sanitizePluginText(raw: string, max: number): string {
  const flattened = raw
    // C0 + DEL + C1, plus U+2028/U+2029 — those are LINE and PARAGRAPH SEPARATOR, which
    // CSS treats as forced breaks (security review LOW-2), so without them the stated
    // "a newline breaks the status bar's layout" was still reachable.
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    // Invisible formatting: bidi overrides/isolates that could rewrite the reading order
    // of a line, plus the zero-width and BOM characters that pad a string invisibly past
    // the length cap.
    // U+200C ZWNJ and U+200D ZWJ are deliberately NOT stripped (§260 Phase 4a security
    // re-review, LOW-2): they carry no reordering power, they are orthographically
    // required in Persian/Arabic and Indic scripts, and ZWJ is what joins emoji
    // sequences — removing it split 👨‍💻 into two glyphs, in a tier whose status-bar text
    // is emoji-first. Korean/CJK were never affected: no Hangul, jamo, kana or ideograph
    // falls in any stripped range.
    .replace(
      /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g,
      "",
    )
    .trim();
  return flattened.length > max
    ? `${flattened.slice(0, max - 1)}\u2026`
    : flattened;
}
