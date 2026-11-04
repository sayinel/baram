// §5.1 What an HTML block's text reads back as when the file is opened again.
import type { Fragment, Node as PmNode, Schema } from "@tiptap/pm/model";

import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { parseMdast } from "../../../pipeline/parse-mdast";
import { serializeDetachedDoc } from "../../../utils/editor/serialize-live-doc";

/** Where in the document the block stands, as far as reading it depends on
 *  that. */
export interface HtmlBlockContext {
  /** The block is the document's first, where the file can hold front
   *  matter. */
  atStart?: boolean;
  /** The identifiers of the document's footnote definitions: a footnote
   *  reference is one only where its definition is in the file. */
  footnotes?: readonly string[];
}

/** What an HTML block's text reads back as. */
export type HtmlBlockReading =
  /** Other blocks, which save as markdown that reads the same as the text. */
  | { blocks: Fragment; kind: "blocks" }
  /** One HTML block holding the same text. */
  | { kind: "itself" }
  /** Something else: other blocks that save differently or that the schema
   *  does not allow, or, when `merges`, a reading that joins the text with
   *  the blocks next to it (an unclosed `<!--` takes in the blocks after it;
   *  `: x` makes the paragraph before it a term). */
  | { kind: "otherwise"; merges: boolean };

// Two paragraphs around the text stand for its neighbours. At the top level
// of a document blocks are written one blank line apart, so there this is how
// the file holds the text.
const BEFORE = "baram-html-block-before";
const AFTER = "baram-html-block-after";

/** The context `readHtmlBlock` needs for the HTML block at `pos` in `doc`. */
export function htmlBlockContext(doc: PmNode, pos: number): HtmlBlockContext {
  const footnotes: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "footnoteDefinition") {
      footnotes.push(node.attrs.identifier as string);
    }
  });
  return { atStart: pos === 0, footnotes };
}

/**
 * Read `content` the way opening the file would, between two paragraphs —
 * after none when the block is the document's first — with the document's
 * footnote definitions after them.
 *
 * The block's text is written to the file as it is, and the loader decides
 * what it is when the file is opened: CommonMark ends a `<div>`-style HTML
 * block at a blank line (a line of only spaces or tabs is blank), text that
 * does not start like an HTML block is not one, and a block of the kinds that
 * end at a closing marker (`<!--`, `<pre>`, `<script>`, `<style>`,
 * `<textarea>`, `<?`, `<!` and a letter, `<![CDATA[`) runs on through the
 * blocks after it until a line holding the marker.
 *
 * The blocks it reads as are taken only when saving them writes markdown that
 * parses to the same tree as the text, and the schema accepts them. What the
 * loader drops or changes in a way the markdown tree records fails the first
 * — `<span>` around a word read as the word alone, a code fence's info string
 * after the language, `<img src="a.png">` read as an image and written as
 * `![](a.png)` — while a change of spelling alone does not (`_a_` is written
 * `*a*`). A list's looseness is left out of the comparison: the editor has no
 * place for it, so every list in the file loses it on the next save. The
 * loader can also put together blocks the schema does not allow
 * (`- <div>x</div>`, a list item that starts with an HTML block).
 *
 * The neighbours are paragraphs here. Text kept as typed is written as it
 * is, so a list just before the block takes in a first line indented as far
 * as the item's text (`  <div>x</div>` after `- a` becomes part of its item).
 */
export function readHtmlBlock(
  content: string,
  schema: Schema,
  { atStart = false, footnotes = [] }: HtmlBlockContext = {},
): HtmlBlockReading {
  const definitions = footnotes.map((id) => `[^${id}]: x\n\n`).join("");
  const before = atStart ? "" : `${BEFORE}\n\n`;
  const source = `${before}${content}\n\n${AFTER}\n\n${definitions}`;
  const doc = markdownToProsemirror(source, schema);
  const around = (atStart ? 1 : 2) + footnotes.length;
  const after = doc.childCount - footnotes.length - 1;
  if (
    doc.childCount < around ||
    (!atStart && !isSentinel(doc.firstChild, BEFORE)) ||
    !isSentinel(doc.child(after), AFTER)
  ) {
    return { kind: "otherwise", merges: true };
  }
  let from = 0;
  if (!atStart) from = (doc.firstChild as PmNode).nodeSize;
  let to = 0;
  for (let i = 0; i < after; i++) to += doc.child(i).nodeSize;
  const blocks = doc.content.cut(from, to);
  const only = blocks.childCount === 1 ? blocks.firstChild : null;
  if (only?.type.name === "htmlBlock" && only.attrs.content === content) {
    return { kind: "itself" };
  }
  const same =
    spelling(parseMdast(serializeDetachedDoc(doc))) ===
      spelling(parseMdast(source)) && fitsSchema(blocks);
  return same
    ? { blocks, kind: "blocks" }
    : { kind: "otherwise", merges: false };
}

function fitsSchema(blocks: Fragment): boolean {
  try {
    blocks.forEach((node) => node.check());
    return true;
  } catch {
    return false;
  }
}

function isSentinel(node: null | PmNode, text: string): boolean {
  return node?.type.name === "paragraph" && node.textContent === text;
}

/** A tree as JSON, apart from where in the source each node was and whether
 *  a list is loose. */
function spelling(tree: unknown): string {
  return JSON.stringify(tree, (key, value: unknown) =>
    key === "position" || key === "spread" ? undefined : value,
  );
}
