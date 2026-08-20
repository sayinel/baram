// §4.8 The canonical prose word/character counter.
//
// WHY this file exists: the app had THREE counters that disagreed on the same document —
// the status bar (`doc.textContent`), the Word Count plugin (the markdown SOURCE, so `#`
// and `|` were words) and the journal stats cache (a line-based stripper that dropped
// heading lines entirely). Two of them were wrong in opposite directions, so a user with
// the plugin installed saw two different numbers side by side in one status bar.
//
// The policy below is stated ONCE and every surface reads it from here.
import type { Node as PmNode } from "@tiptap/pm/model";

/**
 * What separates two blocks' text.
 *
 * ‼️ THE original defect was that there was none. `doc.textContent` is
 * `textBetween(0, size, "")`, and prosemirror-model's `Fragment.textBetween` guards its
 * separator with `&& blockSeparator` — `""` is falsy, so nothing was inserted and the last
 * word of every block fused with the first word of the next. The undercount was exactly
 * (textblocks − 1): `docs/faq.md` reported 5,961 words instead of 6,317, and ten
 * one-word paragraphs reported "1 words".
 *
 * Any whitespace would do, since the tokenizer splits on `\s+`; a newline is chosen so the
 * extracted text stays readable when logged or staged to a plugin.
 */
const BLOCK_SEPARATOR = "\n";

/**
 * Characters of prose in a ProseMirror document.
 *
 * Deliberately the same text the word count is taken from, so the status bar's tooltip
 * cannot describe a different document than the number next to it.
 */
export function countDocumentChars(doc: PmNode): number {
  return documentProseText(doc).length;
}

/** Words of prose in a ProseMirror document. */
export function countDocumentWords(doc: PmNode): number {
  return countWords(documentProseText(doc));
}

/** The one tokenizer. Whitespace-separated tokens, empty runs collapsed. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * The document's prose, as one string.
 *
 * Code is excluded via `spec.code`, which is a PROPERTY rather than an enumeration of node
 * names — it is true for exactly `codeBlock` and `frontmatter` today, and a code-ish node
 * added later inherits the exclusion instead of silently counting `const` and `=` as words.
 * An enumerated denylist would have defaulted the next addition to "counts as prose".
 */
export function documentProseText(doc: PmNode): string {
  const parts: string[] = [];
  doc.descendants((node) => {
    if (node.type.spec.code) return false;
    if (node.isTextblock) {
      // `textBetween` over the inline content, so marks (`**bold**`) contribute their text
      // once and without their markers, and atoms go through `leafProse`.
      const text = node.textBetween(
        0,
        node.content.size,
        BLOCK_SEPARATOR,
        leafProse,
      );
      if (text) parts.push(text);
      return false;
    }
    if (node.isLeaf) {
      // A block-level atom (an image, a math block, a mermaid diagram). Never inside a
      // textblock, so `textBetween` above never sees it.
      const text = leafProse(node);
      if (text) parts.push(text);
      return false;
    }
    // A container (blockquote, list, table, callout) — keep descending to its textblocks.
    // Pushing nothing here is what makes a 2x2 table four words rather than one.
    return true;
  });
  return parts.join(BLOCK_SEPARATOR);
}

/**
 * The prose a LEAF node contributes.
 *
 * ProseMirror atoms hold their text in `attrs`, never in a text node, so `textContent`
 * counted every one of these as zero — a note written mostly of `[[wikilinks]]` counted far
 * below what is on screen. The rule is what the READER sees: a wikilink's label, a tag and
 * a mention are words; a formula, a diagram source, an image's alt text and transcluded
 * content from another note are not.
 */
function leafProse(node: PmNode): string {
  const { attrs } = node;
  switch (node.type.name) {
    // Not text at all, but a line break — and without it "Hello there\world again" fused
    // into three words, the same defect as a block boundary one level down.
    case "hardBreak":
      return BLOCK_SEPARATOR;
    case "mention":
      return typeof attrs.value === "string" ? attrs.value : "";
    case "tagNode":
      return typeof attrs.tag === "string" ? attrs.tag : "";
    case "wikilink": {
      // The alias is what renders when there is one, so `[[some-page|Some Page]]` is two
      // words ("Some Page"), not one slug.
      const display = typeof attrs.display === "string" ? attrs.display : "";
      if (display) return display;
      return typeof attrs.target === "string" ? attrs.target : "";
    }
    // Everything else contributes nothing: math (block and inline), mermaid, svg, query and
    // html blocks are source rather than prose; an image's alt text is not rendered when the
    // image is; a table of contents is generated; a block reference or embed shows another
    // note's words, which belong to that note's count.
    default:
      return "";
  }
}
