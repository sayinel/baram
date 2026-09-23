// §373 Smart punctuation — typed `->` becomes `→`, and so on.
//
// Off by default (`smartPunctuation` in settings) because it changes the bytes
// a user saves. The result is plain text, so the pipeline needs no transformer
// and the file round-trips as the characters it now holds. Paste is left
// alone: there are no paste rules, so pasted code and logs keep their `->`.
//
// Where a rule must NOT fire — code, an unclosed link or name, math being
// edited, skill files — is decided in one place, `shouldSubstitute`.
import { Extension, InputRule } from "@tiptap/core";

import { shouldSubstitute } from "./smart-punctuation-guards";

export interface SmartPunctuationRule {
  find: RegExp;
  id: string;
  /** `$1` stands for the rule's first capture group. */
  replace: string;
}

/**
 * The table in spec 0056 §373, in the order the rules are tried.
 *
 * Rules match the key just typed appended to the text before the caret in its
 * textblock — at most the last 500 characters of it (Tiptap's
 * `getTextContentFromNodes`), which is ample for one-character lookbehinds. Two rules look for another
 * rule's RESULT, because the intermediate replacement has already happened
 * by the time the third key arrives: `<->` is `←` then `>`, and `<=>` is `≤`
 * then `>`.
 */
export const SMART_PUNCTUATION_RULES: readonly SmartPunctuationRule[] = [
  // Not after a dash: `-->` closes an HTML comment.
  { find: /(?<!-)->$/, id: "arrowRight", replace: "→" },
  { find: /<-$/, id: "arrowLeft", replace: "←" },
  { find: /←>$/, id: "arrowBoth", replace: "↔" },
  // Not after `<`: a `<=` pasted, or typed while the setting was off, is
  // still `<=`, and `>` after it must not become `<⇒`.
  { find: /(?<!<)=>$/, id: "doubleRight", replace: "⇒" },
  { find: /<=$/, id: "lessEqual", replace: "≤" },
  { find: /≤>$/, id: "iff", replace: "⇔" },
  { find: />=$/, id: "greaterEqual", replace: "≥" },
  { find: /!=$/, id: "notEqual", replace: "≠" },
  { find: /\.\.\.$/, id: "ellipsis", replace: "…" },
  // ‼️ Fires on the key AFTER `--`, never on the second dash itself: replacing
  // `--` at once would turn a third dash into `—-`, and `---` (the horizontal
  // rule, a table delimiter) could no longer be typed. It also stays out when
  // the next key is `>` (`-->`), a dash, or Enter's `\n` — input rules run on
  // Enter too, and a rule that fires takes the key, so the line would not
  // split. Today the core keymap (priority 100) claims Enter before this
  // extension (50) is asked; the `\n` exclusion keeps that from depending on
  // the order, and has its own test. The lookbehind asks for one
  // character that is neither `-` nor `!`: that keeps out a fourth dash, the
  // `<!--` of an HTML comment, and the start of a textblock. `|` on either
  // side keeps out a table delimiter row, where one dash per cell is enough
  // (`|--|`). The `u` flag makes the next key one code point, so an emoji
  // after `--` counts as the one character it is.
  { find: /(?<=[^!|-])--([^>|\n-])$/u, id: "emDash", replace: "—$1" },
];

export const SmartPunctuation = Extension.create({
  name: "smartPunctuation",

  // Below the default 100, so structural rules (horizontal rule, blockquote,
  // lists, marks) see a key first. Far below vim's 10000.
  priority: 50,

  addInputRules() {
    return SMART_PUNCTUATION_RULES.map(
      (rule) =>
        new InputRule({
          find: rule.find,
          handler: ({ match, range, state }) => {
            if (!shouldSubstitute(state, range)) return null;
            const text = rule.replace.replace("$1", match[1] ?? "");
            state.tr.insertText(text, range.from, range.to);
          },
        }),
    );
  },
});
