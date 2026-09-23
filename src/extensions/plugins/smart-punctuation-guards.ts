// §373–§374 Smart punctuation — whether a typed `->` may become `→` here.
//
// Every rule in `smart-punctuation.ts` asks this before replacing anything.
// The reasons to refuse live in one place so a new rule cannot forget one.
//
// ‼️ Tiptap's own input-rule check skips code nodes and marks whose spec says
// `code: true`. Baram's `Code` mark does not say so (§7.2 — see `code.ts`), so
// that check never covers inline code; `shouldSubstitute` checks the mark.
import type { ResolvedPos } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

import { useSettingsStore } from "../../stores/settings/store";
import { isSkillFrontmatter } from "../../utils/skill/skill-frontmatter";
import { TAG_BODY } from "../../utils/tags/tag-lexicon";
import { mathEditKey } from "./math-inline-edit";

/**
 * Openers whose text is a name or a destination until the closer is typed,
 * at which point an input rule turns it into a node or mark. A `→` typed
 * inside ends up in that name: `[[a->b` would link to a different file.
 */
const UNCLOSED_PAIRS: readonly (readonly [string, string])[] = [
  ["[[", "]]"],
  ["{{", "}}"],
  ["((", "))"],
  ["[^", "]"],
  ["](", ")"],
  // An HTML comment being typed: its body is not prose, and `-->` must close it.
  ["<!--", "-->"],
];

/** A tag being typed — `tag-node.ts` turns `#name` into a node on the space. */
const TAG_IN_PROGRESS = new RegExp(`#${TAG_BODY}$`);

/**
 * Whether the text replaced at `range` may be turned into a symbol.
 *
 * `range` is the input rule's range: `from` is where the matched text starts
 * in the document, `to` is the caret, and the key just typed is not in the
 * document yet. So there are two places to look for code — the matched text
 * (`--` typed as the first characters of code opened with Mod+E carries the
 * mark, while the text before it does not) and the marks the typed key will
 * take at the caret. The mark just BEFORE `from` decides nothing: right after
 * code closed with its backtick it is still code, yet `->` typed there is not.
 */
export function shouldSubstitute(
  state: EditorState,
  range: { from: number; to: number },
): boolean {
  if (useSettingsStore.getState().smartPunctuation !== true) return false;
  if (isSkillFile(state)) return false;
  if (isCodeOrMathEditAt(state, range)) return false;
  return !isLiteralContext(literalScanText(state.doc.resolve(range.from)));
}

/** Whether `before` holds an odd number of backticks — a code span still open. */
function hasOpenBacktick(before: string): boolean {
  return (before.match(/`/g)?.length ?? 0) % 2 === 1;
}

/**
 * Whether `$from` sits after an unclosed backtick in its textblock (§374-3):
 * inline code not yet closed, or inline code the caret is in, which
 * SyntaxReveal has expanded to literal backticks — no `code` mark is left
 * there for `isCodeAt` to see. Text in inline code that is still
 * marked reads as U+FFFC (see literalScanText), so its backticks do not count.
 * Shared with the `:` autocomplete (§375) so both agree on what counts as code.
 */
export function insideOpenBacktick($from: ResolvedPos): boolean {
  return hasOpenBacktick(literalScanText($from));
}

/**
 * Whether `range` is inside inline code: the matched text has the `code` mark,
 * or the key typed at `range.to` will take it. Shared with the `:`
 * autocomplete (§375), which must not open there either. (See
 * shouldSubstitute for why the match and the caret are both checked.)
 */
export function isCodeAt(
  state: EditorState,
  range: { from: number; to: number },
): boolean {
  const code = state.schema.marks.code;
  if (!code) return false;
  if (state.doc.rangeHasMark(range.from, range.to, code)) return true;
  const incoming = state.storedMarks ?? state.doc.resolve(range.to).marks();
  return code.isInSet(incoming) !== undefined;
}

/**
 * Whether `range` is inside inline code or an open inline-math edit — the
 * literal contexts a typed key can be in without its textblock being code.
 *
 * ‼️ The math half reads MathInlineEdit's state from `state`, which is right
 * for an input rule (it runs on the view's finished state) and wrong inside
 * another plugin's state `apply`, where that field may not be computed yet.
 * The `:` autocomplete therefore uses `isCodeAt` and its own math check.
 */
export function isCodeOrMathEditAt(
  state: EditorState,
  range: { from: number; to: number },
): boolean {
  if (isCodeAt(state, range)) return true;
  const math = mathEditKey.getState(state);
  return Boolean(
    math?.active && math.from <= range.from && range.from <= math.to,
  );
}

/**
 * Whether the textblock text before a rule's match is inside something that
 * must keep its characters: an unclosed name or destination, inline code not
 * yet closed with its backtick, a URL, or a tag.
 */
function isLiteralContext(before: string): boolean {
  for (const [open, close] of UNCLOSED_PAIRS) {
    const opened = before.lastIndexOf(open);
    if (opened !== -1 && before.indexOf(close, opened + open.length) === -1) {
      return true;
    }
  }
  if (hasOpenBacktick(before)) return true;
  const token = before.slice(before.search(/\S*$/));
  if (token.includes("://")) return true;
  return TAG_IN_PROGRESS.test(before);
}

/**
 * The textblock's text from its start to `$from`, as the pair and backtick
 * checks should see it. Text inside inline code and inline leaf nodes reads
 * as U+FFFC: code keeps its characters already, and a `((` or a backtick in it
 * must not look like an opener for the rest of the line.
 */
function literalScanText($from: ResolvedPos): string {
  const start = $from.start();
  const end = $from.pos;
  let out = "";
  $from.doc.nodesBetween(start, end, (node, pos) => {
    if (node.isText) {
      const text = node.text!.slice(
        Math.max(start, pos) - pos,
        Math.min(end, pos + node.nodeSize) - pos,
      );
      const isCode = node.marks.some((mark) => mark.type.name === "code");
      out += isCode ? "\ufffc".repeat(text.length) : text;
      return false;
    }
    if (node.isInline) {
      out += "\ufffc";
      return false;
    }
    return true;
  });
  return out;
}

/**
 * A skill file is what Skills mode (`use-skills-mode.ts`) says it is: the same
 * `isSkillFrontmatter`, so the Skills UI and this exemption cannot disagree.
 *
 * ‼️ It reads the node's text, not `attrs.yaml`. The attribute is filled once
 * when the file is parsed (`frontmatter-transformer.ts`) and does not follow
 * edits; saving writes the text.
 */
function isSkillFile(state: EditorState): boolean {
  const first = state.doc.firstChild;
  return (
    first?.type.name === "frontmatter" && isSkillFrontmatter(first.textContent)
  );
}
