// §5.6 The regex source a search term reads as, for the in-document find
// (`buildSearchRegex`). The search panel's Replace does not build a JS pattern: the Rust
// search's own replacement makes it (`replaceSearchMatches`).

/**
 * The source of the regex a search reads `term` as: escaped as text unless
 * `useRegex`, and with `wholeWord` put in a group between word boundaries,
 * `\b(?:…)\b`, so the boundaries hold every alternative — `a|b` finds the word
 * `a` or the word `b`, where the wrap without the group, `\ba|b\b`, reads as `\ba`
 * or `b\b`. The Rust search wraps the same way (`search::build_pattern`).
 *
 * `null` when `useRegex` and `term` is no expression as typed. Asked of `term`
 * itself, not of the wrap: the group can make an invalid expression valid —
 * `a)|(b` becomes `\b(?:a)|(b)\b`.
 */
export function searchPatternSource(
  term: string,
  useRegex: boolean,
  wholeWord: boolean,
): null | string {
  let pattern = term;
  if (useRegex) {
    try {
      new RegExp(term);
    } catch {
      return null;
    }
  } else {
    pattern = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return wholeWord ? `\\b(?:${pattern})\\b` : pattern;
}
