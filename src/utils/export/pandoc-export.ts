// §55 Pandoc Extended Export — Baram MD → standard Pandoc-compatible MD preprocessing
// Pure utility functions (no external dependencies)

import { replaceOutsideCode } from "../markdown/markdown-code-regions";

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
  result = convertUnderlineForPandoc(result);

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
    // `$a == b$` is math, not a highlight.
    { inlineMath: true, markup: true },
  );
}

// ---------------------------------------------------------------------------
// Individual converters
// ---------------------------------------------------------------------------

/**
 * Subscript, superscript and underline in pandoc's OWN spellings — `~x~`,
 * `^x^`, `[x]{.underline}` — never as raw HTML. The docx writer ignores raw
 * HTML, and the export's Lua policy filter drops every raw node on pandoc's
 * parse (issue 544), so `<sub>`/`<sup>`/`<u>` would reach no writer at all;
 * the native forms render everywhere (docx `vertAlign`/`w:u`, epub
 * `<sub>`/`<u>`, latex `\textsubscript`/`\ul`). Baram's `~x~`/`^x^` are the
 * same syntax pandoc uses, with two differences this pass settles: pandoc
 * requires an inner space to be escaped (`~a\ b~`), and a span may not cross
 * a line. What counts as a span is Baram's own rule (convert-inline-text.ts,
 * the editor's parser): the delimiters hug a non-space character on both
 * sides, so `~90,000 ... ( ~1.05 GB` and `^ up or ^ down` are prose, exactly
 * as the editor shows them. Matches never touch code spans, fences or math
 * (`replaceOutsideCode` rejects any overlap, not only a start inside).
 */
export function convertSubscriptForPandoc(md: string): string {
  return replaceOutsideCode(
    md,
    /(?<!~)~([^~\s](?:[^~\n]*[^~\s])?)~(?!~)/g,
    (_match, content: string) => `~${escapePandocInnerSpaces(content)}~`,
    { inlineMath: true, markup: true },
  );
}

/** Superscript as `^text^`, by the same hugging rule; a footnote reference
 *  `[^id]` is excluded by the `[` lookbehind and the `]` exclusion. */
export function convertSuperscriptForPandoc(md: string): string {
  return replaceOutsideCode(
    md,
    /(?<!\^)(?<!\[)\^([^^\s[\]](?:[^^\n[\]]*[^^\s[\]])?)\^(?!\^)/g,
    (_match, content: string) => `^${escapePandocInnerSpaces(content)}^`,
    { inlineMath: true, markup: true },
  );
}

/**
 * Underline: the serializer writes `<u>…</u>` (pm-to-md.ts); pandoc's
 * bracketed span with the `underline` class is what its writers render. The
 * content may hold other marks, a link, a `<br>`, a soft line break — but not
 * a blank line, which would end the paragraph. Brackets inside the content
 * are kept when they balance (a link survives as a link) and escaped when
 * they do not, since a lone `]` would close the span early and leave
 * `{.underline}` visible in the export.
 */
export function convertUnderlineForPandoc(md: string): string {
  return replaceOutsideCode(
    md,
    /<u>((?:(?!<\/u>)(?:[^\n]|\n(?!\n)))*?)<\/u>/g,
    // No `markup`/`inlineMath` here: the `<u>` tags this pass consumes ARE
    // tags, and an underline may well contain `$…$` — a match that merely
    // overlaps math must still convert, or the underline is lost.
    (_match, content: string) => `[${balanceBrackets(content)}]{.underline}`,
  );
}

/** A space (or tab) inside `~…~` / `^…^` must be `\ ` for pandoc; one
 *  already escaped stays. */
function escapePandocInnerSpaces(content: string): string {
  return content.replace(/(?<!\\)[ \t]/g, "\\ ");
}

/** Escape only the live `[`/`]` that have no partner, so a link inside the
 *  underline survives while a lone `]` cannot close the span early. A bracket
 *  is live when the run of backslashes before it has even length: `\]` is
 *  escaped, `\\]` is an escaped backslash followed by a live bracket. */
function balanceBrackets(content: string): string {
  const unmatched = new Set<number>();
  const stack: number[] = [];
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch !== "[" && ch !== "]") continue;
    let run = 0;
    for (let j = i - 1; j >= 0 && content[j] === "\\"; j--) run += 1;
    if (run % 2 === 1) continue;
    if (ch === "[") stack.push(i);
    else if (stack.length > 0) stack.pop();
    else unmatched.add(i);
  }
  for (const i of stack) unmatched.add(i);
  if (unmatched.size === 0) return content;
  let out = "";
  for (let i = 0; i < content.length; i++) {
    if (unmatched.has(i)) out += "\\";
    out += content[i];
  }
  return out;
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
    { inlineMath: true },
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
