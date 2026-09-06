import { firstNonEmptyLine } from "./selection-markdown";

/**
 * §99 Longest note title drawn as a wikilink pill, in characters.
 *
 * Only borrowed titles get near it: an authored title is a name someone chose,
 * and those are short. A fleeting note's title is its first body line — a whole
 * captured sentence — and the pill has no CSS truncation (`.wikilink` sets no
 * `max-width`, and giving it one would need `display: inline-block`, changing
 * how EVERY wikilink wraps).
 */
export const NOTE_TITLE_DISPLAY_CAP = 60;

/**
 * Truncate a note title for DISPLAY. Never store the result: `idForTitle` looks
 * titles up by exact text and export writes them into `[[id|title]]`, so a
 * truncated title would be unfindable and would export wrong. `firstBodyLine`
 * deliberately does not cap for the same reason — this is the caller-side cap
 * its doc comment refers to.
 */
export function capNoteTitle(title: string): string {
  return title.length > NOTE_TITLE_DISPLAY_CAP
    ? `${title.slice(0, NOTE_TITLE_DISPLAY_CAP - 1)}…`
    : title;
}

/**
 * Extract the leading Zettelkasten id (12-14 digits) from a filename or bare
 * stem. Mirrors Rust's canonical `extract_id_from_stem`
 * (`src-tauri/src/index/normalizer.rs`): the digit run must be followed by a
 * space or be the entire (extension-stripped) stem — e.g.
 * `202607051530-note` has NO id (a hyphen is not a valid separator, unlike
 * the old `\b`-based regex this replaces).
 */
export function extractLeadingId(nameOrStem: string): null | string {
  const stem = nameOrStem.replace(/\.(md|markdown)$/, "");
  const m = stem.match(/^(\d{12,14})(?:\s|$)/);
  return m ? m[1] : null;
}

/**
 * §103 Hub inbox titles: strip a leading YAML frontmatter block, then return
 * the first non-empty body line with any leading heading marker (`#`, `##`,
 * ...) removed. Returns "" when the body has no non-empty content. Does NOT
 * cap length — callers apply their own display truncation.
 */
export function firstBodyLine(md: string): string {
  const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  return firstNonEmptyLine(body).replace(/^#+\s*/, "");
}

export function isZettelId(s: string): boolean {
  return /^\d{12,14}$/.test(s);
}

export function parseNoteTitle(filename: string, content: string): string {
  return parseNoteTitleInfo(filename, content).title;
}

/**
 * `parseNoteTitle`, plus whether the title was AUTHORED — written into
 * frontmatter `title:` or carried by a `{id} {title}` filename — as opposed to
 * step 3's fallback, which just hands back the stem because the note has no
 * name anywhere.
 *
 * ‼️ Callers must not infer "unnamed" by comparing the title to the id. That
 * test is wrong for a note whose real title IS the id string (`title: 20260705…`,
 * or `202607051530 202607051530.md`) — contrived, but the difference between a
 * predicate that is true and one that merely usually is. §99's body-line
 * fallback (`zettel-index.ts`) depends on getting exactly this right.
 */
export function parseNoteTitleInfo(
  filename: string,
  content: string,
): { authored: boolean; title: string } {
  // 1) frontmatter title:
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const m = fm[1].match(/^title:\s*(.+?)\s*$/m);
    if (m) {
      let v = m[1].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (v.length > 0) return { authored: true, title: v };
    }
  }
  // 2) filename title (strip .md, strip leading id + space)
  const stem = filename.replace(/\.(md|markdown)$/, "");
  const stripped = stem.replace(/^\d{12,14}\s+/, "");
  if (stripped.length > 0 && stripped !== stem) {
    return { authored: true, title: stripped };
  }
  // 3) bare id filename → the id itself; else the stem
  return { authored: false, title: stem };
}
