// issue 527 — the markdown export's last word on every link.
//
// Sibling of export-html-links.ts for the routes that leave the app as a
// markdown STRING rather than a DOM clone: Pandoc (docx, epub, latex, rst,
// html5) and Notion. Issue 499 settled the rule — the document model keeps a
// destination byte-for-byte, and each consumer applies the link policy at its
// own output point — but these two consumers had none, so a
// `[click me](javascript:…)` reached pandoc verbatim and came out as a live
// hyperlink in every format (an EPUB reader is a WebKit page).
//
// Runs LAST in each route, after every converter (wikilinks become
// `[x](page.md)`, mermaid fences become `![](asset)`), so nothing downstream
// can rewrite a destination behind its back — the same ordering contract the
// HTML scrub states. It parses the string with the editor's own grammar
// (parse-mdast: gfm, math, YAML frontmatter), so code spans, fences, math and
// frontmatter are never mistaken for links and no regex ever runs over the
// text. A refused link is replaced by its label; the label is re-serialized
// with remark-stringify (configured like the pipeline's serializer — the
// serializer itself sits inside the pm-to-md closure that production code
// outside the pipeline may not import, pm-to-md-import-boundary.test.ts)
// rather than spliced from the source, because a label such as `# heading`
// or `- item` dropped raw at the start of a line would become a heading or a
// list — the serializer escapes exactly those block starters (`\#`, `\-`)
// and keeps inline formatting. Three things the serializer cannot know from
// the label alone are handled here: inside a GFM table cell the label's
// pipes are escaped (the cell ends at the next unescaped pipe, code spans
// included); a label that begins like one of pandoc's list or definition
// markers (`(@x)`, `(a)`, `a.`, `iv)`, `:`) gets the marker's punctuation
// escaped, because pandoc — not remark — would start a block there; and a
// label that ends a heading in `#` or `{…}` gets that escaped, since there it
// would read as the closing sequence or pandoc's attribute block and vanish.
// Labels are also written on ONE line — a soft or hard break inside one
// becomes the space it rendered as — so a label that spanned lines inside a
// block quote or list cannot leave the container's continuation marks behind.
// And because a splice can fuse with its neighbours into new syntax (`<` +
// label + `>` is an autolink, `&` + label + `;` a character reference), a
// left neighbour that could do so is escaped with the edit, and the pass
// repeats on its own output until nothing refused is left. A document with
// nothing to refuse comes back as the very same string.
//
// Reference-style links: every `[label][ref]` (full, collapsed or shortcut)
// whose identifier has ANY refused definition becomes its label. pandoc lets
// the last duplicate definition win where CommonMark lets the first, so the
// union is the only answer that is right for both readers. The definitions
// themselves stay: an unreferenced definition renders as nothing in pandoc
// and Notion, deleting one inside a list item or block quote would leave a
// dangling marker, and an image reference (outside this policy, see below)
// may still need it.
//
// Not covered here, deliberately: raw HTML (`html` nodes — inline raw HTML
// arrives as separate open and close tag nodes, so a per-node sanitizer
// would corrupt it), raw TeX (`\href{javascript:…}{x}` is plain text to
// remark) and image sources. Those are judged one layer later, on pandoc's
// own parse, by the Lua policy filter `src-tauri/src/export/pandoc.rs`
// writes for each export (issues 545 and 544): every raw node is dropped,
// every Link is held to the same scheme policy as here, every Image to the
// staged-asset allowlist. This pass stays the last word on markdown links
// in the string the frontend hands over.
import type { Link, LinkReference, Nodes } from "mdast";

import { visit } from "unist-util-visit";

import { parseMdast } from "../../pipeline/parse-mdast";
import { isAllowedLinkHref } from "../link-href";
import {
  applyEdits,
  innerContext,
  type LabelContext,
  labelText,
  MAX_ROUNDS,
  type SourceEdit,
} from "./export-markdown-splice";

/**
 * Replace every link whose destination {@link isAllowedLinkHref} refuses —
 * inline, angle autolink, or reference-style — with its label. Returns the
 * input string itself when there is nothing to refuse.
 *
 * A splice can hand its neighbours a construct that was not there before:
 * `<[javascript:x](javascript:y)>` is a literal `<`, a refused link and a
 * literal `>`, and would become the autolink `<javascript:x>`; `&[amp](…);`
 * would become the character reference `&amp;`; `[[x](…)](https://…)` would
 * become a link. Two defences. The character to the LEFT of a replaced link
 * is escaped when it is one of `<`, `&`, `[` and not already literal (an odd
 * run of backslashes before it) — a backslash before ASCII punctuation is
 * literal in both grammars — which keeps the visible text and breaks every
 * one of those constructs; on the RIGHT, a label that is only a list number
 * or letter followed by `.`/`)`, an `&` the following text completes into a
 * character reference, or an empty label at a line's content start followed
 * by a block opener, gets the same treatment. And the pass repeats on its own
 * output until a parse finds nothing refused, in case a construct was missed;
 * each round removes at least one link's syntax and writes none. Should that
 * still not settle, the export fails closed rather than ship the
 * intermediate string.
 */
export function stripDisallowedMarkdownLinks(markdown: string): string {
  let out = markdown;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const next = stripOnce(out);
    if (next === out) return out;
    out = next;
  }
  throw new Error(
    `Export link policy did not settle after ${MAX_ROUNDS} passes; refusing to export`,
  );
}

function collectEdits(
  node: Nodes,
  ctx: LabelContext,
  refused: ReadonlySet<string>,
  edits: SourceEdit[],
): void {
  if (node.type === "link" && !isAllowedLinkHref(node.url)) {
    edits.push(labelEdit(node, ctx));
    return;
  }
  if (node.type === "linkReference" && refused.has(node.identifier)) {
    edits.push(labelEdit(node, ctx));
    return;
  }
  if (!("children" in node)) return;
  const inner = innerContext(ctx, node.type);
  for (const child of node.children) collectEdits(child, inner, refused, edits);
}

function labelEdit(node: Link | LinkReference, ctx: LabelContext): SourceEdit {
  // The parser always attaches positions; the non-null assertions state that
  // rather than inventing a fallback that would silently skip a refused link.
  const { end, start } = node.position!;
  return {
    end: end.offset!,
    inLink: ctx.inLink,
    start: start.offset!,
    text: labelText(node.children, ctx),
  };
}

function stripOnce(markdown: string): string {
  const root = parseMdast(markdown);

  // Pass 1: which reference identifiers resolve to a refused destination.
  // (References usually precede their definitions, so this cannot share a
  // walk with the edit collection below.)
  const refusedIdentifiers = new Set<string>();
  visit(root, "definition", (node) => {
    if (!isAllowedLinkHref(node.url)) refusedIdentifiers.add(node.identifier);
  });

  // Pass 2: the links to rewrite, as edits against source offsets. A walk of
  // our own rather than `visit`: whether a label sits inside a table cell or
  // a heading is a question about its ancestry, and only the walk knows that.
  const edits: SourceEdit[] = [];
  collectEdits(
    root,
    { inHeading: false, inLink: false, inTableCell: false },
    refusedIdentifiers,
    edits,
  );
  if (edits.length === 0) return markdown;

  return applyEdits(markdown, edits);
}
