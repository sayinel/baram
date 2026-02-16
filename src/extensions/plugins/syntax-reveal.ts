// §5.1 + §3.3 Syntax Reveal — Typora-style editable inline source mode
// When cursor enters a textblock with marks (or a heading), the block's content
// is replaced with raw markdown text that the user can edit directly.
// When the cursor leaves, the markdown is parsed back to rich content.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as PmNode, Schema } from "@tiptap/pm/model";

interface SyntaxRevealState {
  /** Position before the currently-revealed block node (null if none) */
  revealedBlockPos: number | null;
  /** Decorations for visual styling of revealed block */
  decorations: DecorationSet;
}

const syntaxRevealKey = new PluginKey<SyntaxRevealState>("syntaxReveal");

// ── Inline serialization (PM block → markdown text) ──

/** Serialize a single textblock's inline content to markdown string */
function blockToMarkdown(node: PmNode): string {
  if (node.type.name === "heading") {
    const level = node.attrs.level as number;
    const prefix = "#".repeat(level) + " ";
    return prefix + inlineToMarkdown(node);
  }
  return inlineToMarkdown(node);
}

/** Serialize inline content of a textblock to markdown */
function inlineToMarkdown(node: PmNode): string {
  let result = "";

  node.forEach((child) => {
    if (child.isText) {
      result += textWithMarks(child.text || "", child.marks);
    } else if (child.type.name === "hardBreak") {
      result += "\\\n";
    }
  });

  return result;
}

/** Wrap text with mark delimiters */
function textWithMarks(
  text: string,
  marks: readonly import("@tiptap/pm/model").Mark[],
): string {
  if (marks.length === 0) return text;

  let result = text;

  // Sort marks for consistent output (innermost first)
  const sorted = [...marks].sort((a, b) =>
    a.type.name.localeCompare(b.type.name),
  );

  for (const mark of sorted) {
    const delim = MARK_SYNTAX[mark.type.name];
    if (delim) {
      const open = delim.open;
      const close =
        typeof delim.close === "function" ? delim.close(mark) : delim.close;
      result = open + result + close;
    }
  }

  return result;
}

const MARK_SYNTAX: Record<
  string,
  {
    open: string;
    close: string | ((mark: import("@tiptap/pm/model").Mark) => string);
  }
> = {
  bold: { open: "**", close: "**" },
  italic: { open: "*", close: "*" },
  strike: { open: "~~", close: "~~" },
  code: { open: "`", close: "`" },
  underline: { open: "<u>", close: "</u>" },
  link: {
    open: "[",
    close: (mark) => {
      const href = mark.attrs.href as string;
      const title = mark.attrs.title as string | null;
      return title ? `](${href} "${title}")` : `](${href})`;
    },
  },
};

// ── Inline parsing (markdown text → PM block content) ──

/** Parse a markdown line back into PM inline nodes for a given block type */
function markdownToInlineContent(
  text: string,
  schema: Schema,
  blockTypeName: string,
): { content: PmNode[]; headingLevel?: number } {
  let input = text;
  let headingLevel: number | undefined;

  // Extract heading prefix
  if (blockTypeName === "heading") {
    const headingMatch = input.match(/^(#{1,6})\s/);
    if (headingMatch) {
      headingLevel = headingMatch[1].length;
      input = input.slice(headingMatch[0].length);
    } else {
      // No heading prefix → convert to paragraph
      headingLevel = 0;
    }
  }

  const nodes = parseInlineMarkdown(input, schema);
  return { content: nodes, headingLevel };
}

/** Simple inline markdown parser — handles **, *, ~~, `, <u></u>, [text](url) */
function parseInlineMarkdown(text: string, schema: Schema): PmNode[] {
  const result: PmNode[] = [];
  let i = 0;
  let plainBuf = "";

  const flushPlain = (marks: import("@tiptap/pm/model").Mark[] = []) => {
    if (plainBuf) {
      result.push(schema.text(plainBuf, marks));
      plainBuf = "";
    }
  };

  while (i < text.length) {
    // <u>...</u>
    if (text.startsWith("<u>", i)) {
      flushPlain();
      const closeIdx = text.indexOf("</u>", i + 3);
      if (closeIdx !== -1) {
        const inner = text.slice(i + 3, closeIdx);
        const innerNodes = parseInlineMarkdown(inner, schema);
        const ulMark = schema.marks.underline?.create();
        for (const n of innerNodes) {
          result.push(
            n.isText
              ? schema.text(
                  n.text || "",
                  ulMark ? [...n.marks, ulMark] : n.marks,
                )
              : n,
          );
        }
        i = closeIdx + 4;
        continue;
      }
    }

    // [text](url) or [text](url "title")
    if (text[i] === "[") {
      const linkMatch = text
        .slice(i)
        .match(/^\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
      if (linkMatch) {
        flushPlain();
        const [full, linkText, href, title] = linkMatch;
        const linkMark = schema.marks.link?.create({
          href,
          title: title || null,
        });
        if (linkMark && linkText) {
          result.push(schema.text(linkText, [linkMark]));
        } else if (linkText) {
          result.push(schema.text(linkText));
        }
        i += full.length;
        continue;
      }
    }

    // ** bold **
    if (text.startsWith("**", i)) {
      const closeIdx = text.indexOf("**", i + 2);
      if (closeIdx !== -1) {
        flushPlain();
        const inner = text.slice(i + 2, closeIdx);
        const innerNodes = parseInlineMarkdown(inner, schema);
        const boldMark = schema.marks.bold?.create();
        for (const n of innerNodes) {
          result.push(
            n.isText
              ? schema.text(
                  n.text || "",
                  boldMark ? [...n.marks, boldMark] : n.marks,
                )
              : n,
          );
        }
        i = closeIdx + 2;
        continue;
      }
    }

    // ~~ strikethrough ~~
    if (text.startsWith("~~", i)) {
      const closeIdx = text.indexOf("~~", i + 2);
      if (closeIdx !== -1) {
        flushPlain();
        const inner = text.slice(i + 2, closeIdx);
        const innerNodes = parseInlineMarkdown(inner, schema);
        const strikeMark = schema.marks.strike?.create();
        for (const n of innerNodes) {
          result.push(
            n.isText
              ? schema.text(
                  n.text || "",
                  strikeMark ? [...n.marks, strikeMark] : n.marks,
                )
              : n,
          );
        }
        i = closeIdx + 2;
        continue;
      }
    }

    // ` code `
    if (text[i] === "`") {
      const closeIdx = text.indexOf("`", i + 1);
      if (closeIdx !== -1) {
        flushPlain();
        const inner = text.slice(i + 1, closeIdx);
        const codeMark = schema.marks.code?.create();
        result.push(schema.text(inner, codeMark ? [codeMark] : []));
        i = closeIdx + 1;
        continue;
      }
    }

    // * italic * (single *, not **)
    if (text[i] === "*" && text[i + 1] !== "*") {
      const closeIdx = text.indexOf("*", i + 1);
      if (closeIdx !== -1 && text[closeIdx + 1] !== "*") {
        flushPlain();
        const inner = text.slice(i + 1, closeIdx);
        const innerNodes = parseInlineMarkdown(inner, schema);
        const italicMark = schema.marks.italic?.create();
        for (const n of innerNodes) {
          result.push(
            n.isText
              ? schema.text(
                  n.text || "",
                  italicMark ? [...n.marks, italicMark] : n.marks,
                )
              : n,
          );
        }
        i = closeIdx + 1;
        continue;
      }
    }

    plainBuf += text[i];
    i++;
  }

  flushPlain();
  return result;
}

// ── Check whether a block should be revealed ──

/** Returns true if a textblock has any marks on its inline children or is a heading */
function shouldReveal(node: PmNode): boolean {
  if (node.type.name === "heading") return true;
  if (!node.isTextblock) return false;

  let hasMark = false;
  node.forEach((child) => {
    if (child.marks.length > 0) hasMark = true;
  });
  return hasMark;
}

// ── Build decorations for the revealed block ──

function buildDecorations(
  state: EditorState,
  revealedBlockPos: number | null,
): DecorationSet {
  if (revealedBlockPos == null) return DecorationSet.empty;

  const node = state.doc.nodeAt(revealedBlockPos);
  if (!node) return DecorationSet.empty;

  const nodeEnd = revealedBlockPos + node.nodeSize;
  const decos: Decoration[] = [
    Decoration.node(revealedBlockPos, nodeEnd, {
      class: "syntax-editing",
    }),
  ];

  return DecorationSet.create(state.doc, decos);
}

// ── The ProseMirror Plugin ──

function createSyntaxRevealPlugin(): Plugin<SyntaxRevealState> {
  let isTransforming = false;

  return new Plugin<SyntaxRevealState>({
    key: syntaxRevealKey,

    state: {
      init() {
        return { revealedBlockPos: null, decorations: DecorationSet.empty };
      },

      apply(tr, value, _oldState, newState) {
        // If we dispatched a transformation, reset to track the new revealed block
        const meta = tr.getMeta(syntaxRevealKey) as
          | { revealedBlockPos: number | null }
          | undefined;
        if (meta !== undefined) {
          return {
            revealedBlockPos: meta.revealedBlockPos,
            decorations: buildDecorations(newState, meta.revealedBlockPos),
          };
        }

        // Map positions through document changes
        if (tr.docChanged && value.revealedBlockPos != null) {
          const mapped = tr.mapping.map(value.revealedBlockPos);
          return {
            revealedBlockPos: mapped,
            decorations: buildDecorations(newState, mapped),
          };
        }

        return value;
      },
    },

    appendTransaction(transactions, oldState, newState) {
      if (isTransforming) return null;

      // Only process when selection changed
      const selChanged = transactions.some((tr) => tr.selectionSet);
      if (!selChanged && !transactions.some((tr) => tr.docChanged))
        return null;

      const pluginState = syntaxRevealKey.getState(oldState);
      const oldRevealed = pluginState?.revealedBlockPos ?? null;

      // Find the current cursor block
      const { $from } = newState.selection;
      if (!$from.parent.isTextblock) {
        // Left a textblock entirely
        if (oldRevealed != null) {
          return collapseBlock(oldRevealed, oldState, newState);
        }
        return null;
      }

      const curBlockPos = $from.before($from.depth);
      const curBlock = newState.doc.nodeAt(curBlockPos);
      if (!curBlock) return null;

      // Same block — do nothing
      if (curBlockPos === oldRevealed) return null;

      // Different block — collapse old, possibly reveal new
      const needsReveal = shouldReveal(curBlock);

      // Collapse old revealed block
      if (oldRevealed != null) {
        const collapseTr = collapseBlock(oldRevealed, oldState, newState);
        if (collapseTr) {
          // After collapsing, reveal new block if needed
          if (needsReveal) {
            // We need to chain: collapse → reveal
            // But the collapse changes the doc, so we need to do it in steps
            // Set a flag so the next appendTransaction handles the reveal
            isTransforming = true;
            try {
              // Collapse first, then let next cycle handle reveal
              return collapseTr;
            } finally {
              // Schedule reveal for after collapse
              setTimeout(() => {
                isTransforming = false;
              }, 0);
            }
          }
          return collapseTr;
        }
      }

      // Reveal new block
      if (needsReveal) {
        return revealBlock(curBlockPos, newState);
      }

      return null;
    },

    props: {
      decorations(state) {
        return syntaxRevealKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });

  /** Replace a textblock's rich content with its markdown source text */
  function revealBlock(
    blockPos: number,
    state: EditorState,
  ): Transaction | null {
    const node = state.doc.nodeAt(blockPos);
    if (!node || !node.isTextblock) return null;

    const mdText = blockToMarkdown(node);
    const contentStart = blockPos + 1;
    const contentEnd = blockPos + node.nodeSize - 1;

    const tr = state.tr;

    // Replace content with plain text (no marks)
    if (mdText) {
      tr.replaceWith(contentStart, contentEnd, state.schema.text(mdText));
    } else {
      tr.delete(contentStart, contentEnd);
    }

    // If it was a heading, convert to paragraph for editing
    if (node.type.name === "heading") {
      tr.setNodeMarkup(blockPos, state.schema.nodes.paragraph, {});
    }

    // Proportional cursor position mapping
    const oldCursorOffset = state.selection.from - contentStart;
    const oldContentLen = contentEnd - contentStart;
    const newContentLen = mdText.length;
    let newCursorOffset: number;

    if (oldContentLen > 0) {
      const ratio = oldCursorOffset / oldContentLen;
      newCursorOffset = Math.round(ratio * newContentLen);
    } else {
      newCursorOffset = newContentLen;
    }

    const newCursorPos = contentStart + Math.max(0, Math.min(newCursorOffset, newContentLen));
    tr.setSelection(TextSelection.create(tr.doc, newCursorPos));

    tr.setMeta(syntaxRevealKey, { revealedBlockPos: blockPos });
    tr.setMeta("addToHistory", false);

    return tr;
  }

  /** Parse the markdown text in a revealed block back to rich content */
  function collapseBlock(
    blockPos: number,
    _oldState: EditorState,
    newState: EditorState,
  ): Transaction | null {
    const node = newState.doc.nodeAt(blockPos);
    if (!node || !node.isTextblock) return null;

    // Get the plain text content
    const rawText = node.textContent;
    if (!rawText && node.type.name === "paragraph") {
      // Empty paragraph — just clear the revealed state
      const tr = newState.tr;
      tr.setMeta(syntaxRevealKey, { revealedBlockPos: null });
      tr.setMeta("addToHistory", false);
      return tr;
    }

    const { content, headingLevel } = markdownToInlineContent(
      rawText,
      newState.schema,
      // Check if the raw text starts with # to detect heading
      rawText.match(/^#{1,6}\s/) ? "heading" : node.type.name,
    );

    const contentStart = blockPos + 1;
    const contentEnd = blockPos + node.nodeSize - 1;

    const tr = newState.tr;

    // Replace plain text with rich content
    if (content.length > 0) {
      tr.replaceWith(contentStart, contentEnd, content);
    }

    // If heading prefix was detected, convert to heading
    if (headingLevel && headingLevel >= 1 && headingLevel <= 6) {
      tr.setNodeMarkup(blockPos, newState.schema.nodes.heading, {
        level: headingLevel,
      });
    }

    tr.setMeta(syntaxRevealKey, { revealedBlockPos: null });
    tr.setMeta("addToHistory", false);

    return tr;
  }
}

/** Tiptap Extension wrapper */
export const SyntaxReveal = Extension.create({
  name: "syntaxReveal",

  addProseMirrorPlugins() {
    return [createSyntaxRevealPlugin()];
  },
});
