// notion-export.ts — Convert Baram markdown to Notion-compatible markdown
// Pure utility functions (no external dependencies)

import { replaceOutsideCode } from "../markdown/markdown-code-regions";
import { segmentMarkdownByMermaid } from "../markdown/mermaid-fence";
import { stripMermaidMeta } from "../markdown/mermaid-meta";

// ---------------------------------------------------------------------------
// Unicode subscript / superscript mappings
// ---------------------------------------------------------------------------

const SUBSCRIPT_MAP: Record<string, string> = {
  "0": "\u2080",
  "1": "\u2081",
  "2": "\u2082",
  "3": "\u2083",
  "4": "\u2084",
  "5": "\u2085",
  "6": "\u2086",
  "7": "\u2087",
  "8": "\u2088",
  "9": "\u2089",
  a: "\u2090",
  e: "\u2091",
  h: "\u2095",
  i: "\u1D62",
  j: "\u2C7C",
  k: "\u2096",
  l: "\u2097",
  m: "\u2098",
  n: "\u2099",
  o: "\u2092",
  p: "\u209A",
  r: "\u1D63",
  s: "\u209B",
  t: "\u209C",
  u: "\u1D64",
  v: "\u1D65",
  x: "\u2093",
  "+": "\u208A",
  "-": "\u208B",
  "=": "\u208C",
  "(": "\u208D",
  ")": "\u208E",
};

const SUPERSCRIPT_MAP: Record<string, string> = {
  "0": "\u2070",
  "1": "\u00B9",
  "2": "\u00B2",
  "3": "\u00B3",
  "4": "\u2074",
  "5": "\u2075",
  "6": "\u2076",
  "7": "\u2077",
  "8": "\u2078",
  "9": "\u2079",
  a: "\u1D43",
  b: "\u1D47",
  c: "\u1D9C",
  d: "\u1D48",
  e: "\u1D49",
  f: "\u1DA0",
  g: "\u1D4D",
  h: "\u02B0",
  i: "\u2071",
  j: "\u02B2",
  k: "\u1D4F",
  l: "\u02E1",
  m: "\u1D50",
  n: "\u207F",
  o: "\u1D52",
  p: "\u1D56",
  r: "\u02B3",
  s: "\u02E2",
  t: "\u1D57",
  u: "\u1D58",
  v: "\u1D5B",
  w: "\u02B7",
  x: "\u02E3",
  y: "\u02B8",
  z: "\u1DBB",
  "+": "\u207A",
  "-": "\u207B",
  "=": "\u207C",
  "(": "\u207D",
  ")": "\u207E",
};

// ---------------------------------------------------------------------------
// Unicode helpers
// ---------------------------------------------------------------------------

/** Convert text to Unicode subscript characters.
 *  Returns { text, complete } where complete=true if all chars mapped. */
export function toUnicodeSubscript(text: string): {
  complete: boolean;
  text: string;
} {
  let result = "";
  let complete = true;
  for (const ch of text) {
    const mapped = SUBSCRIPT_MAP[ch];
    if (mapped) {
      result += mapped;
    } else {
      complete = false;
      result += ch;
    }
  }
  return { text: result, complete };
}

/** Convert text to Unicode superscript characters.
 *  Returns { text, complete } where complete=true if all chars mapped. */
export function toUnicodeSuperscript(text: string): {
  complete: boolean;
  text: string;
} {
  let result = "";
  let complete = true;
  for (const ch of text) {
    const mapped = SUPERSCRIPT_MAP[ch];
    if (mapped) {
      result += mapped;
    } else {
      complete = false;
      result += ch;
    }
  }
  return { text: result, complete };
}

// ---------------------------------------------------------------------------
// Individual converters
// ---------------------------------------------------------------------------

// Callout type -> emoji mapping
const CALLOUT_EMOJI_MAP: Record<string, string> = {
  tip: "\u{1F4A1}",
  warning: "\u{26A0}\u{FE0F}",
  danger: "\u{1F525}",
  info: "\u{2139}\u{FE0F}",
  note: "\u{1F4DD}",
  success: "\u{2705}",
  important: "\u{2757}",
  failure: "\u{274C}",
  quote: "\u{1F4AD}",
  pin: "\u{1F4CC}",
  caution: "\u{26A0}\u{FE0F}",
};

/** Convert Baram callouts to Notion-compatible blockquotes.
 *  `> [!tip] Title` + body lines -> `> emoji **Title**\n> body` */
export function convertCalloutsForNotion(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Match callout header: > [!type] optional title
    const calloutMatch = line.match(/^>\s*\[!(\w+)\][+-]?\s*(.*)?$/);
    if (!calloutMatch) {
      result.push(line);
      i++;
      continue;
    }

    const type = calloutMatch[1].toLowerCase();
    const title = (calloutMatch[2] || "").trim();
    const emoji = CALLOUT_EMOJI_MAP[type] || "\u{1F4DD}";
    const displayType = type.charAt(0).toUpperCase() + type.slice(1);

    // Collect subsequent `> ` continuation lines
    const bodyLines: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      // Continue if line starts with `> ` or is a bare `>`
      if (lines[j].match(/^>\s?/)) {
        // Extract content after `> ` or `>`
        const content = lines[j].replace(/^>\s?/, "");
        bodyLines.push(content);
        j++;
      } else {
        break;
      }
    }

    // Build the output
    if (title) {
      // Title present — use: > emoji **Title**
      if (bodyLines.length > 0) {
        result.push(`> ${emoji} **${title}**`);
        for (const bl of bodyLines) {
          result.push(bl === "" ? `>` : `> ${bl}`);
        }
      } else {
        result.push(`> ${emoji} **${title}**`);
      }
    } else {
      // No title — use: > emoji **Type**: body
      if (bodyLines.length > 0) {
        const firstBody = bodyLines[0];
        result.push(`> ${emoji} **${displayType}**: ${firstBody}`);
        for (let k = 1; k < bodyLines.length; k++) {
          const bl = bodyLines[k];
          result.push(bl === "" ? `>` : `> ${bl}`);
        }
      } else {
        result.push(`> ${emoji} **${displayType}**`);
      }
    }

    i = j;
  }

  return result.join("\n");
}

/** Convert Baram definition lists (HTML dl/dt/dd) to Notion-compatible format.
 *  Baram pm-to-md.ts outputs `Term\n: Definition` as html flow node,
 *  but it can also produce `<dl><dt>Term</dt><dd>Def</dd></dl>`.
 *  Convert to: `**Term**\nDefinition` */
export function convertDefinitionListsForNotion(md: string): string {
  // Pattern 1: HTML <dl>...</dl> blocks
  const result = md.replace(
    /<dl>\n?([\s\S]*?)\n?<\/dl>/g,
    (_match, inner: string) => {
      const terms: string[] = [];
      // Extract dt/dd pairs
      const dtRe = /<dt>([\s\S]*?)<\/dt>/g;
      const ddRe = /<dd>([\s\S]*?)<\/dd>/g;
      const dts: string[] = [];
      const dds: string[] = [];
      let m: null | RegExpExecArray;
      while ((m = dtRe.exec(inner)) !== null) dts.push(m[1].trim());
      while ((m = ddRe.exec(inner)) !== null) dds.push(m[1].trim());

      for (let i = 0; i < dts.length; i++) {
        if (i > 0) terms.push("");
        terms.push(`**${dts[i]}**`);
        if (i < dds.length) {
          terms.push(`: ${dds[i]}`);
        }
      }

      return terms.join("\n");
    },
  );

  // Pattern 2: Plain text format from pm-to-md.ts: `Term\n: Definition`
  // These appear as html flow nodes but end up as plain text in the final markdown.
  // Match lines where the next line starts with `: `
  const lines = result.split("\n");
  const output: string[] = [];
  let idx = 0;
  while (idx < lines.length) {
    // Check if next line is a definition (starts with `: `)
    if (idx + 1 < lines.length && /^:\s/.test(lines[idx + 1])) {
      const term = lines[idx];
      // Don't convert if already bold or if it looks like a heading/blockquote etc.
      if (
        !term.startsWith("#") &&
        !term.startsWith(">") &&
        !term.startsWith("-") &&
        !term.startsWith("*") &&
        term.trim() !== ""
      ) {
        output.push(`**${term}**`);
        // Collect all subsequent definition lines
        idx++;
        while (idx < lines.length && /^:\s/.test(lines[idx])) {
          output.push(lines[idx]);
          idx++;
        }
        continue;
      }
    }
    output.push(lines[idx]);
    idx++;
  }

  return output.join("\n");
}

/** Convert footnotes to Notion-compatible format.
 *  Inline refs `[^id]` -> `(id)`, definitions collected to "Notes" section at end. */
export function convertFootnotesForNotion(md: string): string {
  // Collect footnote definitions: [^id]: content
  const defRe = /^\[\^([^\]]+)\]:\s*([\s\S]*?)(?=\n\[\^|\n\n|\n?$)/gm;
  const definitions: Map<string, string> = new Map();
  let m: null | RegExpExecArray;

  // First pass: collect definitions
  const tempMd = md + "\n"; // ensure trailing newline for regex
  while ((m = defRe.exec(tempMd)) !== null) {
    const id = m[1];
    const content = m[2].trim();
    definitions.set(id, content);
  }

  if (definitions.size === 0) return md;

  // Remove definition lines from body
  let result = md
    .replace(/^\[\^[^\]]+\]:\s*[\s\S]*?(?=\n\[\^|\n\n|$)/gm, "")
    .trim();

  // Replace inline references [^id] -> (id)
  // Be careful not to match footnote definitions [^id]:
  result = result.replace(/\[\^([^\]]+)\](?!:)/g, (_match, id: string) => {
    return `(${id})`;
  });

  // Clean up multiple blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  // Append notes section
  const notesLines: string[] = ["", "", "---", "", "**Notes**", ""];
  let num = 1;
  for (const [id, content] of definitions) {
    notesLines.push(`${num}. **${id}**: ${content}`);
    num++;
  }

  return result + notesLines.join("\n");
}

/** Convert Baram markdown to Notion-compatible markdown.
 *  Applies all conversions in order while preserving frontmatter and standard markdown. */
export function convertForNotion(md: string): string {
  let result = md;

  // 1. Block-level conversions first
  result = stripMermaidMetaForNotion(result);
  result = convertCalloutsForNotion(result);
  result = convertToggleForNotion(result);
  result = convertDefinitionListsForNotion(result);
  result = stripTocForNotion(result);
  result = stripBlockRefsForNotion(result);
  result = convertFootnotesForNotion(result);

  // 2. Inline conversions
  result = convertWikilinksForNotion(result);
  result = convertInlineMathForNotion(result);
  result = convertHighlightForNotion(result);
  result = convertSubscriptForNotion(result);
  result = convertSuperscriptForNotion(result);
  result = convertUnderlineForNotion(result);

  return result;
}

/** Convert `==text==` highlight to `**text**` bold (closest Notion equivalent) */
export function convertHighlightForNotion(md: string): string {
  return replaceOutsideCode(
    md,
    /==((?:(?!==).)+)==/g,
    (_match, content: string) => {
      return `**${content}**`;
    },
  );
}

/** Convert inline math `$...$` to Notion's `$$...$$`.
 *  Does not touch block math `$$...$$` or code regions. */
export function convertInlineMathForNotion(md: string): string {
  // Match single $ that are NOT preceded or followed by another $
  return replaceOutsideCode(
    md,
    /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g,
    (_match, content: string) => {
      return `$$${content}$$`;
    },
  );
}

/** Convert `~text~` subscript to Unicode subscript or math fallback.
 *  Does NOT match `~~strikethrough~~`. */
export function convertSubscriptForNotion(md: string): string {
  return replaceOutsideCode(
    md,
    /(?<!~)~(?!~)([^~]+)(?<!~)~(?!~)/g,
    (_match, content: string) => {
      const { text, complete } = toUnicodeSubscript(content);
      if (complete) {
        return text;
      }
      return `$$_{${content}}$$`;
    },
  );
}

/** Convert `^text^` superscript to Unicode superscript or math fallback.
 *  Does NOT match `^^` sequences. */
export function convertSuperscriptForNotion(md: string): string {
  return replaceOutsideCode(
    md,
    /(?<!\^)\^(?!\^)([^^]+)(?<!\^)\^(?!\^)/g,
    (_match, content: string) => {
      const { text, complete } = toUnicodeSuperscript(content);
      if (complete) {
        return text;
      }
      return `$$^{${content}}$$`;
    },
  );
}

/** Convert Baram toggle (details/summary) to Notion-compatible format.
 *  `<details><summary>Title</summary>\n\nBody\n</details>` -> `**triangle Title**\n\nBody` */
export function convertToggleForNotion(md: string): string {
  // Handle multi-line details blocks
  // Pattern: <details> ... <summary>Title</summary> ... body ... </details>
  const detailsRe =
    /<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
  return md.replace(detailsRe, (_match, summary: string, body: string) => {
    const title = summary.trim();
    const bodyContent = body.trim();
    if (bodyContent) {
      return `**\u25B6 ${title}**\n\n${bodyContent}`;
    }
    return `**\u25B6 ${title}**`;
  });
}

/** Convert `<u>text</u>` underline to `*text*` italic (closest Notion alternative) */
export function convertUnderlineForNotion(md: string): string {
  return md.replace(/<u>([\s\S]*?)<\/u>/g, (_match, content: string) => {
    return `*${content}*`;
  });
}

/** Convert wikilinks to standard markdown links.
 *  `[[page]]` -> `[page](page.md)`
 *  `[[page|alias]]` -> `[alias](page.md)`
 *  `[[page#heading]]` -> `[page > heading](page.md#heading)` */
export function convertWikilinksForNotion(md: string): string {
  // Match [[ ... ]] wikilinks — careful not to match inside code
  return replaceOutsideCode(
    md,
    /\[\[([^\]]+)\]\]/g,
    (_match, inner: string) => {
      // Check for alias: [[target|alias]]
      const pipeIdx = inner.indexOf("|");
      let target: string;
      let alias: null | string = null;

      if (pipeIdx >= 0) {
        target = inner.slice(0, pipeIdx).trim();
        alias = inner.slice(pipeIdx + 1).trim();
      } else {
        target = inner.trim();
      }

      // Check for heading: target#heading
      const hashIdx = target.indexOf("#");
      let page = target;
      let heading = "";
      if (hashIdx >= 0) {
        page = target.slice(0, hashIdx);
        heading = target.slice(hashIdx + 1);
      }

      // Build URL: encode spaces
      const urlPage = page.replace(/ /g, "%20");
      const urlSuffix = heading ? `#${heading.replace(/ /g, "%20")}` : "";
      const url = `${urlPage}.md${urlSuffix}`;

      // Build display text
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

/** Remove block references: `((target#^blockId))` and ` ^blockId` suffixes */
export function stripBlockRefsForNotion(md: string): string {
  // Remove ((target#^blockId)) inline refs
  let result = md.replace(/\(\([^)]*#\^[^)]+\)\)/g, "");
  // Remove ^blockId suffixes at end of lines (space + ^ + word chars at EOL)
  result = result.replace(/ \^\w+$/gm, "");
  return result;
}

/** Strip the `%% baram-meta` comment from mermaid fences so Notion imports a
 *  clean `mermaid` code block (Notion renders these natively). */
export function stripMermaidMetaForNotion(md: string): string {
  const segments = segmentMarkdownByMermaid(md);
  const out: string[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      out.push(...seg.lines);
      continue;
    }
    out.push(seg.open);
    const cleaned = stripMermaidMeta(seg.body.join("\n"));
    if (cleaned) out.push(...cleaned.split("\n"));
    if (seg.close !== null) out.push(seg.close);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/** Remove [TOC] lines */
export function stripTocForNotion(md: string): string {
  return md.replace(/^\[TOC\]\s*$/gim, "").replace(/\n{3,}/g, "\n\n");
}
