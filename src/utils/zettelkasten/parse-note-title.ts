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
