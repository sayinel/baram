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
}): { content: string; filename: string } {
  const { id, body, created } = input;
  const filename = `${id}.md`;
  const content =
    `---\n` +
    `id: ${id}\n` +
    `created: ${created}\n` +
    `tags: []\n` +
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

export function sanitizeZettelTitle(title: string): string {
  const cleaned = title.replace(RESERVED, "").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "Untitled";
}
