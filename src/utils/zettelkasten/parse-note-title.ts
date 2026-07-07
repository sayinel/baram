import { firstNonEmptyLine } from "./selection-markdown";

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
  const body = md.replace(/^---\n[\s\S]*?\n---\n?/, "");
  return firstNonEmptyLine(body).replace(/^#+\s*/, "");
}

export function isZettelId(s: string): boolean {
  return /^\d{12,14}$/.test(s);
}

export function parseNoteTitle(filename: string, content: string): string {
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
      if (v.length > 0) return v;
    }
  }
  // 2) filename title (strip .md, strip leading id + space)
  const stem = filename.replace(/\.(md|markdown)$/, "");
  const stripped = stem.replace(/^\d{12,14}\s+/, "");
  if (stripped.length > 0 && stripped !== stem) return stripped;
  // 3) bare id filename → the id itself; else the stem
  return stem;
}
