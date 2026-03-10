// §55 Pandoc Extended Export — Baram MD → standard Pandoc-compatible MD preprocessing
// Pure utility functions (no external dependencies)

// ---------------------------------------------------------------------------
// Helper: protect code blocks and inline code from regex transforms
// ---------------------------------------------------------------------------

interface CodeRegion {
  end: number;
  start: number;
}

/** Convert Baram callouts to simple blockquotes.
 *  `> [!tip] Title` → `> **Tip**: Title` */
export function convertCalloutsForPandoc(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const calloutMatch = line.match(/^>\s*\[!(\w+)\][+-]?\s*(.*)?$/);
    if (!calloutMatch) {
      result.push(line);
      i++;
      continue;
    }

    const type = calloutMatch[1].toLowerCase();
    const title = (calloutMatch[2] || "").trim();
    const displayType = type.charAt(0).toUpperCase() + type.slice(1);

    if (title) {
      result.push(`> **${displayType}**: ${title}`);
    } else {
      result.push(`> **${displayType}**`);
    }

    // Pass through continuation lines
    let j = i + 1;
    while (j < lines.length && lines[j].match(/^>\s?/)) {
      result.push(lines[j]);
      j++;
    }

    i = j;
  }

  return result.join("\n");
}

/** Convert Baram markdown to Pandoc-compatible markdown.
 *  Applies all conversions while preserving standard markdown and definition lists
 *  (Pandoc natively supports `Term\n: Definition`). */
export function convertForPandoc(md: string): string {
  let result = md;

  // 1. Block-level conversions
  result = convertCalloutsForPandoc(result);
  result = convertToggleForPandoc(result);
  result = stripTocForPandoc(result);
  result = stripBlockRefsForPandoc(result);

  // 2. Inline conversions
  result = convertWikilinksForPandoc(result);
  result = convertHighlightForPandoc(result);
  result = convertSubscriptForPandoc(result);
  result = convertSuperscriptForPandoc(result);

  // Note: Definition lists (Term\n: Def) are kept as-is — Pandoc supports them natively.
  // Note: Footnotes are kept as-is — Pandoc supports [^id] natively.
  // Note: Math ($...$, $$...$$) is kept as-is — Pandoc supports them natively.

  return result;
}

/** Convert `==text==` highlight to `**text**` (Pandoc doesn't support highlight) */
export function convertHighlightForPandoc(md: string): string {
  return replaceOutsideCode(
    md,
    /==((?:(?!==).)+)==/g,
    (_match, content: string) => {
      return `**${content}**`;
    },
  );
}

// ---------------------------------------------------------------------------
// Individual converters
// ---------------------------------------------------------------------------

/** Convert `~text~` subscript to `<sub>text</sub>` (Pandoc recognizes HTML sub/sup) */
export function convertSubscriptForPandoc(md: string): string {
  return replaceOutsideCode(
    md,
    /(?<!~)~(?!~)([^~]+)(?<!~)~(?!~)/g,
    (_match, content: string) => {
      return `<sub>${content}</sub>`;
    },
  );
}

/** Convert `^text^` superscript to `<sup>text</sup>`.
 *  Does not match across lines or inside footnote refs `[^id]`. */
export function convertSuperscriptForPandoc(md: string): string {
  return replaceOutsideCode(
    md,
    /(?<!\^)(?<!\[)\^(?!\^)([^^\\n[\]]+)\^(?!\^)/g,
    (_match, content: string) => {
      return `<sup>${content}</sup>`;
    },
  );
}

/** Convert toggle (details/summary) to blockquote.
 *  `<details><summary>Title</summary>Body</details>` → `> **▶ Title**\n>\n> Body` */
export function convertToggleForPandoc(md: string): string {
  const detailsRe =
    /<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
  return md.replace(detailsRe, (_match, summary: string, body: string) => {
    const title = summary.trim();
    const bodyContent = body.trim();
    if (bodyContent) {
      const bodyLines = bodyContent
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      return `> **\u25B6 ${title}**\n>\n${bodyLines}`;
    }
    return `> **\u25B6 ${title}**`;
  });
}

/** Convert wikilinks to standard markdown links.
 *  `[[page]]` → `[page](page.md)`
 *  `[[page|alias]]` → `[alias](page.md)` */
export function convertWikilinksForPandoc(md: string): string {
  return replaceOutsideCode(
    md,
    /\[\[([^\]]+)\]\]/g,
    (_match, inner: string) => {
      const pipeIdx = inner.indexOf("|");
      let target: string;
      let alias: null | string = null;

      if (pipeIdx >= 0) {
        target = inner.slice(0, pipeIdx).trim();
        alias = inner.slice(pipeIdx + 1).trim();
      } else {
        target = inner.trim();
      }

      const hashIdx = target.indexOf("#");
      let page = target;
      let heading = "";
      if (hashIdx >= 0) {
        page = target.slice(0, hashIdx);
        heading = target.slice(hashIdx + 1);
      }

      const urlPage = page.replace(/ /g, "%20");
      const urlSuffix = heading ? `#${heading.replace(/ /g, "%20")}` : "";
      const url = `${urlPage}.md${urlSuffix}`;

      let displayText: string;
      if (alias) {
        displayText = alias;
      } else if (heading) {
        displayText = `${page} > ${heading}`;
      } else {
        displayText = page;
      }

      return `[${displayText}](${url})`;
    },
  );
}

/** Remove block references and block IDs */
export function stripBlockRefsForPandoc(md: string): string {
  let result = md.replace(/\(\([^)]*#\^[^)]+\)\)/g, "");
  result = result.replace(/ \^\w+$/gm, "");
  return result;
}

/** Remove [TOC] lines */
export function stripTocForPandoc(md: string): string {
  return md.replace(/^\[TOC\]\s*$/gim, "").replace(/\n{3,}/g, "\n\n");
}

/** Collect all protected regions (code blocks, inline code, math blocks) */
function collectCodeRegions(md: string): CodeRegion[] {
  const regions: CodeRegion[] = [];

  // Fenced code blocks: ``` or ~~~
  const fencedRe = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1\s*$/gm;
  let m: null | RegExpExecArray;
  while ((m = fencedRe.exec(md)) !== null) {
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  // Block math: $$...$$ (multiline)
  const blockMathRe = /\$\$[\s\S]*?\$\$/g;
  while ((m = blockMathRe.exec(md)) !== null) {
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  // Inline code: `...`
  const inlineCodeRe = /`[^`\n]+`/g;
  while ((m = inlineCodeRe.exec(md)) !== null) {
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  return regions;
}

function isInCodeRegion(pos: number, regions: CodeRegion[]): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

function replaceOutsideCode(
  md: string,
  pattern: RegExp,
  replacer: (match: string, ...groups: string[]) => string,
): string {
  const regions = collectCodeRegions(md);
  const globalRe = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g",
  );
  return md.replace(globalRe, (match: string, ...args: unknown[]) => {
    const offset = args[args.length - 2] as number;
    if (isInCodeRegion(offset, regions)) {
      return match;
    }
    return replacer(match, ...(args.slice(0, -2) as string[]));
  });
}
