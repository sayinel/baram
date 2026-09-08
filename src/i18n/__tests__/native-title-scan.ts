// Shared check for "chrome copy goes to the app's hover pill, never to a native `title`".
//
// Extracted from `extensions/nodes/__tests__/block-chrome-i18n.test.tsx` when the toolbar
// widgets got the same treatment. Two copies would have been two rules, and this one has
// already been wrong twice in ways a second copy would have inherited.
//
// ## What is being forbidden, and what is not
//
// A native `title` is not wrong in itself — the DOCUMENT's own words belong in one
// (`![alt](src "title")` round-trips to `<img title>`, and a wikilink's un-truncated heading is
// content too). What is wrong is putting UI COPY there: `title` puts the right words on screen
// about a second late on WebKit, and chrome that only exists while the pointer is inside a
// block or a floating bar is gone by the time they arrive.
//
// ## ‼️ Why the check is a COUNT and not a pattern
//
// It started as "no `title={t("some.key")}`", and that pattern was wrong twice:
//
//   1. It anchored on `title={t(`, so a `t()` call inside a TERNARY escaped — which certified
//      the one control on that branch nobody had converted (the wikilink vault badge).
//   2. Widened to find `t(` anywhere in the braces, it still could not see
//      `title={commandLabel("formatting.bold")}` or `title={t(label)}` — a translated string
//      reached through a helper or a variable. Nine of the floating toolbar's own labels were
//      that exact shape, and a mutation putting one back SURVIVED.
//
// Each fix taught the same thing: the value's SHAPE cannot decide this, because
// `title={svgTitle}` (translated) and `title={zettelTitle}` (content) are the same syntax. So
// the burden is inverted, the way `prose-scanner.ts` inverts it — EVERY `title=` is reported,
// and a consumer dismisses one only by naming its file in a budget with the reason. New chrome
// with a native `title` then fails by default, whatever its value looks like.
//
// The count also fails when a `title` is REMOVED, which is deliberate: the budget is meant to
// ratchet down, and a stale allowance is how a rule quietly stops meaning anything.

/** One offending `title`, identified so an exception can be named by file and key. */
export interface NativeTitleHit {
  file: string;
  key: string;
}

export interface NativeTitleScan {
  /** How many `title=` attributes the file sets, however the value is spelled. */
  count: number;
  /** `el.title = x` and `setAttribute("title", x)` — the imperative ways in. */
  imperative: string[];
  /** A literal `title="…"`: untranslated AND native, so worse than a translated one. */
  literals: string[];
  /**
   * The subset whose value calls `t("some.key")` directly. Not the rule — {@link count} is —
   * but a much better failure message when it fires, because it names the key.
   */
  translated: NativeTitleHit[];
}

/**
 * Every native `title` in `source`.
 *
 * @param file repo-relative path, used to build the `file:key` id an allowlist names.
 */
export function scanForNativeTitles(
  file: string,
  source: string,
): NativeTitleScan {
  return {
    count: [...source.matchAll(/\btitle=/g)].length,
    // ‼️ `\s*=` and not `= `: the spaced form was all the first version matched, so dropping
    // one space was a way through it.
    imperative: [
      ...source.matchAll(/\.title\s*=[^=]/g),
      ...source.matchAll(/setAttribute\(\s*["']title["']/g),
    ].map((m) => m[0]),
    literals: [...source.matchAll(/title="([^"{]+)"/g)].map((m) => m[1]),
    // `t(` anywhere inside the braces; `[^}]*` stops at the closing brace so a `t()` call in a
    // LATER prop cannot be blamed on this one.
    translated: [...source.matchAll(/title=\{[^}]*\bt\(\s*"([^"]+)"/g)].map(
      (m) => ({ file, key: m[1] }),
    ),
  };
}

/** `file:key`, the form an allowlist of deliberate exceptions names. */
export function titleHitId(hit: NativeTitleHit): string {
  return `${hit.file}:${hit.key}`;
}
