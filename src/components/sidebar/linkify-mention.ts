// §34 Unlinked mentions → wikilink. §390 spec 0069 §3.3 · D7.

/**
 * `line` with its first `matchText` replaced by a link to the note `stem` —
 * `[[stem]]` when the mention spells the name, `[[stem|mention]]` otherwise —
 * or null when the line no longer holds `matchText`.
 *
 * ‼️ `matchText` is searched as it is, not folded. It is the text the
 * backend's regex matched in this line when it scanned the note
 * (`find_unlinked_mentions`, which searches a copy of the line with literal
 * stretches blanked to the same byte length), so no index measured on a
 * folded copy cuts the line. The search takes the first occurrence of those
 * bytes; the backend matches whole words only and skips code, HTML, math,
 * images, link definitions and `[[…]]` links, so it may have matched a later
 * one, and then the link lands on the first (as before §390).
 * ‼️ The mention and the name compare in NFC only, not under `foldName`: a
 * mention in another case (`baram` for `Baram.md` — the backend matches case
 * insensitively) keeps its own text as the link's. Folding would write
 * `[[Baram]]` over the user's `baram`, in another note, past undo.
 * The name is written composed (D7). The mention's text is the user's and is
 * kept as written when it becomes the alias (`[[name|mention]]`); a mention
 * that spells the name is replaced by the name, composed.
 */
export function linkifyMention(
  line: string,
  matchText: string,
  stem: string,
): null | string {
  const at = line.indexOf(matchText);
  if (at === -1) return null;
  const name = stem.normalize("NFC");
  const link =
    matchText.normalize("NFC") === name
      ? `[[${name}]]`
      : `[[${name}|${matchText}]]`;
  return line.slice(0, at) + link + line.slice(at + matchText.length);
}
