// §260 — plugin-supplied text on its way into the app's own chrome.
//
// Moved out of `sandbox/host-ui-bridge` in Phase 4c, when the settings pane became the
// second surface that renders author-controlled text (a `label` from the manifest). The
// rule has to be ONE implementation: it is the kind of thing a second copy gets subtly
// wrong, and the ranges below each carry a reason that would not survive being retyped.
// Kept tier-agnostic — the manifest is author-controlled in both tiers — so it must not
// pull in a store or a bridge.

/**
 * Attribution is a badge, not a sentence: the longest a plugin name or id is drawn as a source
 * label.
 */
export const MAX_SOURCE_CHARS = 32;

/**
 * §391 spec 0070 D11 · D16 — the longest `menu`/`slash` title a manifest may declare, and the cap
 * every entry point draws a plugin command's title at (the right-click menu, the slash list,
 * Settings > Keybindings, the command palette). One number for both, so a title that validates
 * is drawn whole.
 */
export const MAX_ENTRY_TITLE_CHARS = 64;

/** §391 spec 0070 D11 · D16 — the same for a slash item's `description`. */
export const MAX_ENTRY_DESCRIPTION_CHARS = 120;

/**
 * The plugin's name as a badge (§260 Phase 4a HIGH-1, §385 spec 0061 §8): sanitised and capped,
 * falling back to the id — also capped, since `validateManifest` charset-checks ids but does not
 * bound their length. One function for every badge: the sandboxed toast, the trusted toast and
 * the prompt window. The name is author-chosen and may read "Baram"; what tells the user a
 * plugin is speaking is the badge element (toast) or the host's fixed prefix (prompt), not this.
 */
export function pluginSourceLabel(
  name: string | undefined,
  pluginId: string,
): string {
  return (
    sanitizePluginText(name ?? "", MAX_SOURCE_CHARS) ||
    sanitizePluginText(pluginId, MAX_SOURCE_CHARS)
  );
}

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

/**
 * `text` with every lone surrogate replaced by U+FFFD (§385 spec 0061 §9). Rust's
 * `serde_json::Value` refuses a lone surrogate escape, so a frame carrying one through
 * `plugin_sandbox_send` would vanish. Not `String.prototype.toWellFormed`: the `lib` in
 * `tsconfig.json` is ES2022, which does not declare it. In `u` mode a well-formed pair is one
 * code point, so the class matches lone halves only.
 */
export function wellFormedText(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/gu, "\ufffd");
}
