/** Zettelkasten note + frontmatter builders (pure; caller supplies id + created). */

const RESERVED_CHARS = ["/", "\\", ":", "*", "?", '"', "<", ">", "|", "#"];
const RESERVED = new RegExp(
  `[${RESERVED_CHARS.map((c) => `\\${c}`).join("")}]`,
  "g",
);

export function buildFleetingNote(input: {
  body: string;
  created: string;
  id: string;
  /** §99 A: capture tags stored as the frontmatter `tags:` array (not inline in the body). */
  tags?: string[];
}): { content: string; filename: string } {
  const { id, body, created, tags = [] } = input;
  const filename = `${id}.md`;
  const content =
    `---\n` +
    `id: ${id}\n` +
    `created: ${created}\n` +
    `tags: [${tags.join(", ")}]\n` +
    `---\n\n` +
    `${body}\n`;
  return { filename, content };
}

export function buildPermanentNote(input: {
  created: string;
  id: string;
  title: string;
}): { content: string; filename: string } {
  const { id, title, created } = input;
  const filename = `${id} ${sanitizeZettelTitle(title)}.md`;
  const content =
    `---\n` +
    `id: ${id}\n` +
    `title: ${title}\n` +
    `created: ${created}\n` +
    `tags: []\n` +
    `aliases: []\n` +
    `---\n\n` +
    `# ${title}\n`;
  return { filename, content };
}

/**
 * Parse the `tags:` array out of a note's YAML frontmatter — inline
 * (`tags: [a, b]`) or block-list (`tags:\n  - a`) form. Returns [] when the
 * note has no frontmatter or no tags field. Used to carry a fleeting note's
 * tags forward when it is promoted to a permanent note.
 */
export function parseFrontmatterTags(md: string): string[] {
  const fmMatch = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const fm = fmMatch[1];
  const inline = fm.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inline) {
    return inline[1]
      .split(",")
      .map((t) => t.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  const block = fm.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
  if (block) {
    return block[1]
      .split("\n")
      .map((line) =>
        line
          .replace(/^\s+-\s+/, "")
          .trim()
          .replace(/^["']|["']$/g, ""),
      )
      .filter(Boolean);
  }
  return [];
}

export function sanitizeZettelTitle(title: string): string {
  const cleaned = title.replace(RESERVED, "").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "Untitled";
}
