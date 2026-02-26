// §53 Notion markdown converter — pure utility functions for importing Notion exports

/** 32-char hex ID pattern at end of a name (before extension) */
const NOTION_ID_RE = /\s+[a-f0-9]{32}$/;

// ---------------------------------------------------------------------------
// stripNotionId
// ---------------------------------------------------------------------------

/** Strip Notion's 32-char hex ID suffix from a filename (without extension) */
export function stripNotionId(name: string): string {
  return name.replace(NOTION_ID_RE, "");
}

// ---------------------------------------------------------------------------
// emojiToCalloutType
// ---------------------------------------------------------------------------

const EMOJI_CALLOUT_MAP: Record<string, string> = {
  "\u{1F4A1}": "tip", // 💡
  "\u{26A0}\u{FE0F}": "warning", // ⚠️
  "\u{2757}": "important", // ❗
  "\u{2139}\u{FE0F}": "info", // ℹ️
  "\u{1F525}": "danger", // 🔥
  "\u{1F4DD}": "note", // 📝
  "\u{2705}": "success", // ✅
  "\u{274C}": "failure", // ❌
  "\u{1F4CC}": "pin", // 📌
  "\u{1F4AD}": "quote", // 💭
};

/** Map emoji to callout type. Unknown emoji defaults to "note". */
export function emojiToCalloutType(emoji: string): string {
  return EMOJI_CALLOUT_MAP[emoji] ?? "note";
}

// ---------------------------------------------------------------------------
// buildFileMap
// ---------------------------------------------------------------------------

/**
 * Build a filename map: original Notion filename -> clean filename.
 * Handles conflicts by appending " (1)", " (2)", etc.
 */
export function buildFileMap(filenames: string[]): Map<string, string> {
  const result = new Map<string, string>();
  // Track how many times each clean name has been seen
  const seen = new Map<string, number>();

  for (const original of filenames) {
    const dotIdx = original.lastIndexOf(".");
    let baseName: string;
    let ext: string;
    if (dotIdx >= 0) {
      baseName = original.slice(0, dotIdx);
      ext = original.slice(dotIdx);
    } else {
      baseName = original;
      ext = "";
    }

    const cleanBase = stripNotionId(baseName);
    const cleanFull = cleanBase + ext;

    const count = seen.get(cleanFull) ?? 0;
    seen.set(cleanFull, count + 1);

    if (count === 0) {
      result.set(original, cleanFull);
    } else {
      result.set(original, cleanBase + ` (${count})` + ext);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// convertNotionCallouts
// ---------------------------------------------------------------------------

// Match <aside>...</aside> blocks (non-greedy, dotall via [\s\S])
const ASIDE_RE = /<aside>\n([\s\S]*?)\n<\/aside>/g;

// Match leading emoji at start of first line. Emoji can be multi-codepoint.
// We capture the first grapheme cluster (up to 4 codepoints) followed by a space.
const LEADING_EMOJI_RE = /^(\S+)\s/;

/** Convert Notion <aside> callouts to Baram > [!type] syntax */
export function convertNotionCallouts(content: string): string {
  return content.replace(ASIDE_RE, (_match, inner: string) => {
    const lines = inner.split("\n");
    const firstLine = lines[0];

    // Try to extract leading emoji
    const emojiMatch = firstLine.match(LEADING_EMOJI_RE);
    let calloutType = "note";
    let firstLineText = firstLine;

    if (emojiMatch) {
      const emoji = emojiMatch[1];
      const mapped = EMOJI_CALLOUT_MAP[emoji];
      if (mapped !== undefined) {
        calloutType = mapped;
        firstLineText = firstLine.slice(emojiMatch[0].length);
      } else {
        // Unknown emoji — still use it, but type defaults to note
        calloutType = "note";
        firstLineText = firstLine.slice(emojiMatch[0].length);
      }
    }

    // Build blockquote callout lines
    const resultLines = [`> [!${calloutType}]`, `> ${firstLineText}`];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === "") {
        resultLines.push(">");
      } else {
        resultLines.push(`> ${line}`);
      }
    }

    return resultLines.join("\n");
  });
}

// ---------------------------------------------------------------------------
// convertNotionLinks
// ---------------------------------------------------------------------------

// Match markdown links: [text](url)
// Negative lookbehind for ! to avoid matching images
const MD_LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;

/** Convert Notion internal links to wikilinks. External links are left unchanged. */
export function convertNotionLinks(
  content: string,
  fileMap: Map<string, string>,
): string {
  return content.replace(MD_LINK_RE, (fullMatch, linkText: string, url: string) => {
    // Skip external links
    if (/^https?:\/\//i.test(url)) {
      return fullMatch;
    }

    // Decode URL-encoded filename
    const decoded = decodeURIComponent(url);

    // Look up in file map
    const cleanName = fileMap.get(decoded);
    if (!cleanName) {
      return fullMatch;
    }

    // Remove extension for wikilink target
    const targetWithoutExt = cleanName.replace(/\.[^.]+$/, "");

    if (linkText === targetWithoutExt) {
      return `[[${targetWithoutExt}]]`;
    } else {
      return `[[${targetWithoutExt}|${linkText}]]`;
    }
  });
}

// ---------------------------------------------------------------------------
// convertNotionImages
// ---------------------------------------------------------------------------

// Match markdown images: ![alt](path)
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** Convert Notion image paths — strip hex IDs from directory names */
export function convertNotionImages(
  content: string,
  _fileMap: Map<string, string>,
): string {
  return content.replace(MD_IMAGE_RE, (fullMatch, alt: string, url: string) => {
    // Skip external URLs
    if (/^https?:\/\//i.test(url)) {
      return fullMatch;
    }

    // Decode, clean path segments, re-encode spaces
    const decoded = decodeURIComponent(url);
    const segments = decoded.split("/");
    const cleanSegments = segments.map((seg, idx) => {
      // Only strip IDs from directory segments and the filename
      if (idx < segments.length - 1) {
        // Directory segment — strip ID suffix
        return stripNotionId(seg);
      }
      // Last segment is the actual image filename — keep as-is
      return seg;
    });

    // Re-encode spaces as %20
    const cleanPath = cleanSegments
      .map((seg) => seg.replace(/ /g, "%20"))
      .join("/");

    return `![${alt}](${cleanPath})`;
  });
}

// ---------------------------------------------------------------------------
// convertNotionCsv
// ---------------------------------------------------------------------------

/** Simple CSV line parser that handles quoted fields */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ("")
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

/** Convert database CSV to YAML frontmatter + markdown table */
export function convertNotionCsv(csvContent: string): {
  frontmatter: string;
  table: string;
} {
  const lines = csvContent.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { frontmatter: "", table: "" };
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => parseCsvLine(line));

  // Build YAML frontmatter from first data row
  let frontmatter = "---\n";
  if (rows.length > 0) {
    for (let i = 0; i < headers.length; i++) {
      const value = rows[0][i] ?? "";
      frontmatter += `${headers[i]}: ${value}\n`;
    }
  }
  frontmatter += "---";

  // Build markdown table
  const headerRow = "| " + headers.join(" | ") + " |";
  const separator =
    "| " + headers.map(() => "---").join(" | ") + " |";
  const dataRows = rows.map(
    (row) =>
      "| " +
      headers.map((_, i) => row[i] ?? "").join(" | ") +
      " |",
  );

  const table = [headerRow, separator, ...dataRows].join("\n");

  return { frontmatter, table };
}

// ---------------------------------------------------------------------------
// convertNotionMarkdown (orchestrator)
// ---------------------------------------------------------------------------

/**
 * Main orchestrator: convert a single Notion markdown file.
 * Applies all conversions in order: callouts, links, images.
 */
export function convertNotionMarkdown(
  content: string,
  fileMap: Map<string, string>,
): string {
  let result = content;
  result = convertNotionCallouts(result);
  result = convertNotionLinks(result, fileMap);
  result = convertNotionImages(result, fileMap);
  return result;
}

// ---------------------------------------------------------------------------
// cleanNotionPath
// ---------------------------------------------------------------------------

/** Rename a path by stripping Notion IDs from all path segments */
export function cleanNotionPath(path: string): string {
  const segments = path.split("/");
  const cleanSegments = segments.map((seg) => {
    // Check if segment has an extension
    const dotIdx = seg.lastIndexOf(".");
    if (dotIdx >= 0) {
      const base = seg.slice(0, dotIdx);
      const ext = seg.slice(dotIdx);
      return stripNotionId(base) + ext;
    }
    // Directory segment (no extension)
    return stripNotionId(seg);
  });
  return cleanSegments.join("/");
}
