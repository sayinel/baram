/**
 * §56c — Memories View utility: One Line extraction + Memories data grouping
 */

/** Memory entry for grouping */
export interface MemoryEntry {
  content: string;
  path: string;
  year: number;
}

/** Extract the Diary section content (markdown) from journal content */
export function extractDiarySection(content: string): string {
  if (!content.trim()) return "";

  // Strip frontmatter
  const fmMatch = content.match(/^---\n[\s\S]*?\n---/);
  const body = fmMatch
    ? content.slice(fmMatch[0].length).trim()
    : content.trim();
  if (!body) return "";

  const diaryMatch = body.match(/^## Diary\s*$/m);
  if (!diaryMatch) return "";

  const diaryStart = diaryMatch.index! + diaryMatch[0].length;
  const nextSectionMatch = body.slice(diaryStart).match(/^## /m);
  const diaryContent = nextSectionMatch
    ? body.slice(diaryStart, diaryStart + nextSectionMatch.index!)
    : body.slice(diaryStart);

  return diaryContent.trim();
}

/** Extract image references from journal markdown content */
export function extractImages(content: string): { alt: string; src: string }[] {
  if (!content.trim()) return [];

  const images: { alt: string; src: string }[] = [];
  // Match ![alt](src) pattern
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    images.push({ alt: match[1], src: match[2] });
  }
  return images;
}

/** Extract a one-line summary from journal markdown content */
export function extractOneLine(content: string): string {
  if (!content.trim()) return "";

  // 1. Check frontmatter `oneline` field first
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const onelineMatch = fmMatch[1].match(/^oneline:\s*"?([^"\n]+)"?\s*$/m);
    if (onelineMatch) return onelineMatch[1].trim();
  }

  // 2. Strip frontmatter
  const body = fmMatch
    ? content.slice(fmMatch[0].length).trim()
    : content.trim();
  if (!body) return "";

  // 3. Try to extract from ## Diary section only (skip Captures)
  const diaryMatch = body.match(/^## Diary\s*$/m);
  let textBlock: string;

  if (diaryMatch) {
    const diaryStart = diaryMatch.index! + diaryMatch[0].length;
    const nextSectionMatch = body.slice(diaryStart).match(/^## /m);
    textBlock = nextSectionMatch
      ? body.slice(diaryStart, diaryStart + nextSectionMatch.index!)
      : body.slice(diaryStart);
  } else {
    // Fallback: full body excluding Captures section
    const capturesMatch = body.match(/^## Captures\s*$/m);
    if (capturesMatch) {
      // Find next section after Captures
      const afterCaptures = body.slice(
        capturesMatch.index! + capturesMatch[0].length,
      );
      const nextSection = afterCaptures.match(/^## /m);
      if (nextSection) {
        // Use content before Captures + content after Captures section
        const beforeCaptures = body.slice(0, capturesMatch.index!);
        const afterCapturesContent = afterCaptures.slice(nextSection.index!);
        textBlock = beforeCaptures + afterCapturesContent;
      } else {
        textBlock = body.slice(0, capturesMatch.index!);
      }
    } else {
      textBlock = body;
    }
  }

  // 4. Find first meaningful text line (skip headings, empty lines, blockquotes, list items starting with icons)
  const lines = textBlock.split("\n");
  const textLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith(">")) continue;
    if (
      trimmed.startsWith("- ✦") ||
      trimmed.startsWith("- ↗") ||
      trimmed.startsWith("- ❝") ||
      trimmed.startsWith("- ☰")
    )
      continue;
    textLines.push(trimmed);
  }

  if (textLines.length === 0) return "";

  const firstLine = textLines[0];

  // If this is the only text line and contains multiple sentences, extract first sentence
  if (textLines.length === 1) {
    const sentenceMatch = firstLine.match(/^(.+?[.。])\s/);
    if (sentenceMatch) {
      const result = sentenceMatch[1];
      if (result.length > 100) return result.slice(0, 100) + "…";
      return result;
    }
  }

  // Truncate at 100 characters
  if (firstLine.length > 100) {
    return firstLine.slice(0, 100) + "…";
  }
  return firstLine;
}

/** Group memory entries by year in reverse chronological order */
export function groupMemoriesByYear(entries: MemoryEntry[]): MemoryEntry[] {
  if (entries.length === 0) return [];

  return [...entries].sort((a, b) => b.year - a.year);
}

/**
 * Render simple markdown to HTML for preview.
 * Handles: paragraphs, bold, italic, inline code, links, images, headings, lists, blockquotes, hr.
 */
export function renderSimpleMarkdown(md: string): string {
  if (!md.trim()) return "";

  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = escaped.split("\n");
  const html: string[] = [];
  let inList: "ol" | "ul" | null = null;
  let inBlockquote = false;
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      html.push(`<p>${inlineMarkdown(paragraphLines.join(" "))}</p>`);
      paragraphLines = [];
    }
  };

  const closeList = () => {
    if (inList) {
      html.push(`</${inList}>`);
      inList = null;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      html.push("</blockquote>");
      inBlockquote = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Empty line
    if (!trimmed) {
      flushParagraph();
      closeList();
      closeBlockquote();
      continue;
    }

    // Heading
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      closeList();
      closeBlockquote();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      closeList();
      closeBlockquote();
      html.push("<hr/>");
      continue;
    }

    // Blockquote
    const bqMatch = trimmed.match(/^&gt;\s?(.*)$/);
    if (bqMatch) {
      flushParagraph();
      closeList();
      if (!inBlockquote) {
        html.push("<blockquote>");
        inBlockquote = true;
      }
      html.push(`<p>${inlineMarkdown(bqMatch[1])}</p>`);
      continue;
    }

    // Unordered list
    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      closeBlockquote();
      if (inList !== "ul") {
        closeList();
        html.push("<ul>");
        inList = "ul";
      }
      html.push(`<li>${inlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      closeBlockquote();
      if (inList !== "ol") {
        closeList();
        html.push("<ol>");
        inList = "ol";
      }
      html.push(`<li>${inlineMarkdown(olMatch[1])}</li>`);
      continue;
    }

    // Task list item
    const taskMatch = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      flushParagraph();
      closeBlockquote();
      if (inList !== "ul") {
        closeList();
        html.push("<ul>");
        inList = "ul";
      }
      const checked = taskMatch[1] !== " " ? " checked disabled" : " disabled";
      html.push(
        `<li><input type="checkbox"${checked}/> ${inlineMarkdown(taskMatch[2])}</li>`,
      );
      continue;
    }

    // Regular text → paragraph
    closeList();
    closeBlockquote();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  closeList();
  closeBlockquote();

  return html.join("\n");
}

/** Update or insert the `oneline` field in frontmatter */
export function updateOneLineFrontmatter(
  content: string,
  newOneLine: string,
): string {
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/);
  if (fmMatch) {
    const fmBody = fmMatch[2];
    const onelineRegex = /^oneline:\s*.*$/m;
    if (onelineRegex.test(fmBody)) {
      // Replace existing oneline
      const updatedBody = fmBody.replace(
        onelineRegex,
        `oneline: "${newOneLine}"`,
      );
      return (
        fmMatch[1] + updatedBody + fmMatch[3] + content.slice(fmMatch[0].length)
      );
    } else {
      // Append oneline to existing frontmatter
      return (
        fmMatch[1] +
        fmBody +
        `\noneline: "${newOneLine}"` +
        fmMatch[3] +
        content.slice(fmMatch[0].length)
      );
    }
  } else {
    // No frontmatter — prepend one
    return `---\noneline: "${newOneLine}"\n---\n${content}`;
  }
}

/** Convert inline markdown syntax to HTML */
function inlineMarkdown(text: string): string {
  // 1. Extract images and links first to protect them from inline formatting
  const placeholders: string[] = [];
  let processed = text
    // Images: ![alt](src)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
      // Strip backslash escapes in alt text
      const cleanAlt = alt.replace(/\\(.)/g, "$1").replace(/"/g, "&quot;");
      const safeSrc = sanitizeUrl(
        src,
        [/^https?:\/\//, /^data:image\//, /^\.\//, /^\/[^/]/],
        "",
      );
      const idx = placeholders.length;
      placeholders.push(`<img alt="${cleanAlt}" src="${safeSrc}"/>`);
      return `\x00PH${idx}\x00`;
    })
    // Links: [text](url)
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_m: string, linkText: string, href: string) => {
        const safeHref = sanitizeUrl(
          href,
          [/^https?:\/\//, /^mailto:/, /^#/],
          "#",
        );
        const safeText = linkText.replace(/"/g, "&quot;");
        const idx = placeholders.length;
        placeholders.push(`<a href="${safeHref}">${safeText}</a>`);
        return `\x00PH${idx}\x00`;
      },
    );

  // 2. Apply inline formatting (only * based — _ conflicts with filenames)
  processed = processed
    // Inline code: `text` (protect from further processing)
    .replace(/`([^`]+)`/g, (_m, code) => {
      const idx = placeholders.length;
      placeholders.push(`<code>${code}</code>`);
      return `\x00PH${idx}\x00`;
    })
    // Bold+Italic: ***text***
    .replace(/\*{3}(.+?)\*{3}/g, "<strong><em>$1</em></strong>")
    // Bold: **text**
    .replace(/\*{2}(.+?)\*{2}/g, "<strong>$1</strong>")
    // Italic: *text*
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Strikethrough: ~~text~~
    .replace(/~~(.+?)~~/g, "<del>$1</del>");

  // 3. Restore placeholders
  processed = processed.replace(
    /\x00PH(\d+)\x00/g, // eslint-disable-line no-control-regex
    (_m, idx) => placeholders[Number(idx)],
  );

  return processed;
}

/** Sanitize a URL for use in src/href attributes, and HTML-escape the result */
function sanitizeUrl(
  url: string,
  allowedPrefixes: RegExp[],
  fallback: string,
): string {
  const trimmed = url.trim();
  const allowed = allowedPrefixes.some((re) => re.test(trimmed));
  const safe = allowed ? trimmed : fallback;
  return safe.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
