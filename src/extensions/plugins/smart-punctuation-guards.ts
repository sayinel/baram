// §373–§374 Smart punctuation — whether a typed `->` may become `→` here.
//
// Every rule in `smart-punctuation.ts` asks this before replacing anything.
// The reasons to refuse live in one place so a new rule cannot forget one.
//
// ‼️ Tiptap's own input-rule check skips code nodes and marks whose spec says
// `code: true`. Baram's `Code` mark does not say so (§7.2 — see `code.ts`), so
// that check never covers inline code; `shouldSubstitute` checks the mark.
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
];

/** A tag being typed — `tag-node.ts` turns `#name` into a node on the space. */
const TAG_IN_PROGRESS = new RegExp(`#${TAG_BODY}$`);

/**
 * Whether the text replaced at `range` may be turned into a symbol.
 *
 * `range` is the input rule's range — its `from` is where the matched text
 * starts, so everything checked here is what precedes the rule's own match.
 */
export function shouldSubstitute(
  state: EditorState,
  range: { from: number; to: number },
): boolean {
  if (useSettingsStore.getState().smartPunctuation !== true) return false;
  if (isSkillFile(state)) return false;

  const $from = state.doc.resolve(range.from);
  const marks = state.storedMarks ?? $from.marks();
  if (marks.some((mark) => mark.type.name === "code")) return false;

  const math = mathEditKey.getState(state);
  if (math?.active && math.from <= range.from && range.from <= math.to) {
    return false;
  }

  // Leaf nodes read as U+FFFC so they neither vanish nor pair with anything.
  const before = state.doc.textBetween(
    $from.start(),
    range.from,
    undefined,
    "￼",
  );
  return !isLiteralContext(before);
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
  if ((before.match(/`/g)?.length ?? 0) % 2 === 1) return true;
  const token = before.slice(before.search(/\S*$/));
  if (token.includes("://")) return true;
  return TAG_IN_PROGRESS.test(before);
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
