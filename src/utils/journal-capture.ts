/**
 * §56l — Daily Capture types, parsing, and serialization
 */

export type CaptureType = "idea" | "link" | "quote" | "note";

export interface CaptureItem {
  type: CaptureType;
  title?: string;
  body?: string;
  url?: string;
  source?: string;
  tags?: string[];
}

export const CAPTURE_TYPES: CaptureType[] = ["idea", "link", "quote", "note"];

export const CAPTURE_ICONS: Record<CaptureType, string> = {
  idea: "✦",
  link: "↗",
  quote: "❝",
  note: "☰",
};

const ICON_TO_TYPE: Record<string, CaptureType> = {
  "✦": "idea",
  "↗": "link",
  "❝": "quote",
  "☰": "note",
};

/** Extract the ## Captures section text from content */
export function extractCapturesSection(content: string): string {
  const capturesMatch = content.match(/^## Captures\s*$/m);
  if (!capturesMatch) return "";

  const start = capturesMatch.index! + capturesMatch[0].length;
  const rest = content.slice(start);
  const nextSection = rest.match(/^## /m);
  const section = nextSection ? rest.slice(0, nextSection.index!) : rest;

  return section.trim() ? section : "";
}

/** Parse capture items from markdown content containing a ## Captures section */
export function parseCapturesFromMarkdown(md: string): CaptureItem[] {
  const section = extractCapturesSection(md);
  if (!section.trim()) return [];

  const lines = section.split("\n").filter((l) => l.trim().startsWith("- "));
  return lines.map(parseSingleCaptureLine).filter((item): item is CaptureItem => item !== null);
}

/** Parse a single capture bullet line */
function parseSingleCaptureLine(line: string): CaptureItem | null {
  const trimmed = line.replace(/^-\s*/, "").trim();

  // Detect type by icon prefix
  const firstChar = trimmed.charAt(0);
  const type = ICON_TO_TYPE[firstChar];
  if (!type) return null;

  const rest = trimmed.slice(1).trim();

  switch (type) {
    case "idea":
      return parseIdeaCapture(rest);
    case "link":
      return parseLinkCapture(rest);
    case "quote":
      return parseQuoteCapture(rest);
    case "note":
      return parseNoteCapture(rest);
  }
}

function parseIdeaCapture(text: string): CaptureItem {
  // Format: **title**: body #tag1 #tag2
  const titleMatch = text.match(/^\*\*(.+?)\*\*:\s*(.*)/);
  if (titleMatch) {
    return { type: "idea", title: titleMatch[1], body: titleMatch[2].trim() };
  }
  return { type: "idea", body: text.trim() };
}

function parseLinkCapture(text: string): CaptureItem {
  // Format: [title](url) — body
  const linkMatch = text.match(/^\[(.+?)\]\((.+?)\)(?:\s*—\s*(.*))?/);
  if (linkMatch) {
    return {
      type: "link",
      title: linkMatch[1],
      url: linkMatch[2],
      ...(linkMatch[3] ? { body: linkMatch[3].trim() } : {}),
    };
  }
  return { type: "link", body: text };
}

function parseQuoteCapture(text: string): CaptureItem {
  // Format: "quote text" — source
  const quoteMatch = text.match(/^"(.+?)"\s*(?:—\s*(.+))?/);
  if (quoteMatch) {
    return {
      type: "quote",
      body: quoteMatch[1],
      ...(quoteMatch[2] ? { source: quoteMatch[2].trim() } : {}),
    };
  }
  return { type: "quote", body: text };
}

function parseNoteCapture(text: string): CaptureItem {
  return { type: "note", body: text.trim() };
}


/** Serialize a CaptureItem to a markdown bullet string */
export function serializeCaptureToMarkdown(item: CaptureItem): string {
  const icon = CAPTURE_ICONS[item.type];
  const tagSuffix = item.tags?.length ? " " + item.tags.map((t) => `#${t}`).join(" ") : "";

  switch (item.type) {
    case "idea": {
      if (item.title) {
        return `- ${icon} **${item.title}**: ${item.body ?? ""}${tagSuffix}`.trimEnd();
      }
      return `- ${icon} ${item.body ?? ""}${tagSuffix}`.trimEnd();
    }
    case "link": {
      const link = item.url ? `[${item.title ?? ""}](${item.url})` : (item.title ?? "");
      const bodyPart = item.body ? ` — ${item.body}` : "";
      return `- ${icon} ${link}${bodyPart}${tagSuffix}`.trimEnd();
    }
    case "quote": {
      const sourcePart = item.source ? ` — ${item.source}` : "";
      return `- ${icon} "${item.body ?? ""}"${sourcePart}${tagSuffix}`.trimEnd();
    }
    case "note": {
      return `- ${icon} ${item.body ?? ""}${tagSuffix}`.trimEnd();
    }
  }
}

/** Insert a capture item into journal content, appending to existing Captures section or creating one */
export function insertCaptureIntoContent(content: string, item: CaptureItem): string {
  const serialized = serializeCaptureToMarkdown(item);
  const capturesMatch = content.match(/^## Captures\s*$/m);

  if (capturesMatch) {
    // Append to existing Captures section
    const insertPos = capturesMatch.index! + capturesMatch[0].length;
    const afterCaptures = content.slice(insertPos);
    const nextSection = afterCaptures.match(/^## /m);

    if (nextSection) {
      // Insert before next section
      const sectionContent = afterCaptures.slice(0, nextSection.index!);
      const trimmedSection = sectionContent.trimEnd();
      return (
        content.slice(0, insertPos) +
        "\n" +
        (trimmedSection ? trimmedSection + "\n" : "") +
        serialized +
        "\n\n" +
        afterCaptures.slice(nextSection.index!)
      );
    } else {
      // Append at end
      const trimmedContent = content.trimEnd();
      return trimmedContent + "\n" + serialized;
    }
  } else {
    // Create new Captures section at end
    const trimmedContent = content.trimEnd();
    return trimmedContent + "\n\n## Captures\n\n" + serialized;
  }
}

/**
 * §56l Build a standalone note from a capture item.
 * Returns { filename, content } for the promoted note.
 */
export function buildNoteFromCapture(
  item: CaptureItem,
): { filename: string; content: string } {
  const title = item.title || item.body?.split("\n")[0]?.slice(0, 60) || "Untitled";
  // Sanitize filename
  const safeName = title
    .replace(/[/\\:*?"<>|#]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 80);
  const filename = `${safeName}.md`;

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  if (item.body) {
    lines.push(item.body);
    lines.push("");
  }
  if (item.url) {
    lines.push(`Source: ${item.url}`);
    lines.push("");
  }
  if (item.tags && item.tags.length > 0) {
    lines.push(item.tags.map((t) => `#${t}`).join(" "));
    lines.push("");
  }

  return { filename, content: lines.join("\n") };
}

/**
 * §56l Build a wikilink replacement for a promoted capture.
 * Returns a markdown bullet with wikilink instead of the original capture content.
 */
export function buildPromotedCaptureLink(
  item: CaptureItem,
  noteName: string,
): string {
  const icon = CAPTURE_ICONS[item.type];
  const title = item.title || item.body?.split("\n")[0]?.slice(0, 60) || "Untitled";
  return `- ${icon} [[${noteName}|${title}]]`;
}
