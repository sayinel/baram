// §375 `:` symbol & emoji autocomplete — Tiptap Extension using Suggestion API.
//
// Picking an entry writes the character itself; a `:smile:` shortcode is not
// CommonMark or GFM and would show as those letters anywhere else (spec 0056).
import type { Editor, Range } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { Extension } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";

import { SymbolMenuList } from "../../components/command/SymbolMenu";
import { useSettingsStore } from "../../stores/settings/store";
import { focusEditorView } from "../../utils/editor/focus-editor-view";
import { ensureEmojiLoaded, loadedEmoji } from "./emoji-data";
import { mathEditKey, nextMathEditState } from "./math-inline-edit";
import { insideOpenBacktick, isCodeAt } from "./smart-punctuation-guards";
import { symbolSuggestPluginKey } from "./suggestion-keys";
import { createSuggestionRenderer } from "./suggestion-renderer";
import {
  hasSymbolMatch,
  searchSymbols,
  type SymbolSuggestionItem,
} from "./symbol-search";

/**
 * When `:` is a trigger, in the shape `findSuggestionMatch` takes, so tests can
 * feed the library's own matcher real strings.
 *
 * `allowedPrefixes` holds the colon to a space or the start of the text node:
 * `10:30`, `https://`, `due:` (§303) and `key:: value` pass over. The library
 * looks at one text node only — `symbolSuggestAllowed` extends the same rule
 * across mark boundaries and inline atoms.
 */
export const SYMBOL_TRIGGER = {
  allowSpaces: false,
  allowToIncludeChar: false,
  allowedPrefixes: [" "],
  char: ":",
  startOfLine: false,
};

/** Characters a query needs before anything is suggested (spec 0056 §375). */
export const SYMBOL_MIN_QUERY = 2;

const SYMBOL_MENU_HEIGHT = 280;

/**
 * Whether `:` at `range` may open the menu: the setting is on, the text is not
 * code, and the colon starts a word — the character before it in the
 * textblock is nothing, whitespace or a hard break. Right after bold text, a
 * link or an inline atom the library would open (the text node starts there);
 * `a:b` is the same shape and it does not.
 *
 * "Not code" takes two checks, the same two smart punctuation makes. The mark
 * check (`isCodeAt`) alone is not enough: while the caret is inside inline
 * code, SyntaxReveal expands it to literal backticks with no `code` mark, so
 * the colon is plain text after an opening backtick. That state, and a code
 * span whose closing backtick is not typed yet, is `insideOpenBacktick`.
 *
 * An open inline-math edit is not checked here — see `insideMathEdit`.
 */
export function symbolSuggestAllowed(
  state: EditorState,
  range: { from: number; to: number },
): boolean {
  if (useSettingsStore.getState().symbolSuggest !== true) return false;
  const $from = state.doc.resolve(range.from);
  if ($from.parent.type.spec.code) return false;
  if (isCodeAt(state, range)) return false;
  if (insideOpenBacktick($from)) return false;
  const before = state.doc.textBetween(
    Math.max($from.start(), range.from - 1),
    range.from,
    undefined,
    (leaf) => (leaf.type.name === "hardBreak" ? "\n" : "￼"),
  );
  return before === "" || /\s/u.test(before);
}

/**
 * Whether `range` is inside the TeX source of an inline-math edit once
 * `transaction` is applied.
 *
 * ‼️ Not in `allow`, and not read from the new state. Tiptap puts a
 * later-registered extension's plugins first, so this suggestion plugin's
 * state is computed before MathInlineEdit's, and `mathEditKey.getState` on
 * the state `allow` gets is still undefined. Instead this takes the edit state
 * of `editor.state` — the view's state, which `apply` has not replaced yet,
 * so the state `transaction` starts from — and steps it through
 * `transaction` with MathInlineEdit's own `nextMathEditState`. That step
 * reads the transaction's meta too: re-editing a math atom by typing a key
 * activates the edit and can leave a `:query` before the caret in one
 * transaction.
 *
 * A transaction appended by another plugin (`appendTransaction`) does not
 * start from `editor.state`; ProseMirror tags it with the root transaction as
 * meta `"appendedTransaction"` (prosemirror-state 1.4.4, `applyTransaction`).
 * When it is the first one appended, it starts where the root ends, so the
 * step is replayed over both: SyntaxReveal appends a collapse to the click
 * that re-edits a math atom, and the root's activation meta must count.
 * Further down a chain the transactions in between are not at hand, so
 * nothing is mapped: it refuses when the edit was active before the root, or
 * the root or this transaction activates one. Left uncovered: an edit
 * activated by the meta of an appended transaction in between. In `src/`
 * only MathInlineEdit's own handlers set that meta, each on a transaction it
 * dispatches, and MathInlineEdit has no `appendTransaction`.
 */
function insideMathEdit(
  editor: Editor,
  transaction: Transaction,
  range: { from: number; to: number },
): boolean {
  const start = mathEditKey.getState(editor.state);
  if (!start) return false;
  const root = transaction.getMeta("appendedTransaction") as
    Transaction | undefined;
  const chain = root ? [root, transaction] : [transaction];
  const replayable =
    chain[0].before === editor.state.doc &&
    (!root || transaction.before === root.doc);
  if (!replayable) {
    return (
      start.active ||
      chain.some((tr) => {
        const meta = tr.getMeta(mathEditKey) as typeof start | undefined;
        return meta?.active === true;
      })
    );
  }
  const math = chain.reduce((state, tr) => nextMathEditState(tr, state), start);
  return math.active && math.from <= range.from && range.from <= math.to;
}

/**
 * Replace the `:query` at `range` with `char`. The character takes the stored
 * marks if there are any, else those of the `:query` it replaces — the marks
 * at its start, less non-inclusive ones that stop before its end
 * (`Transaction.insertText` with a range uses `ResolvedPos.marksAcross`).
 */
export function insertSymbol(editor: Editor, range: Range, char: string): void {
  const { view } = editor;
  view.dispatch(
    view.state.tr.insertText(char, range.from, range.to).scrollIntoView(),
  );
  focusEditorView(view);
}

const locale = (): string => useSettingsStore.getState().locale;

export const SymbolSuggest = Extension.create({
  name: "symbolSuggest",

  addProseMirrorPlugins() {
    const editor = this.editor;
    let emojiRequested = false;

    /**
     * Start loading emoji on the first `:` query character. When the table
     * lands, dispatch an empty transaction: the suggestion plugin re-matches on
     * every transaction, so a query that only emoji answer (`:웃음`) opens then,
     * without waiting for another key. A query symbols already answered keeps
     * its symbol-only list until the next key: the suggestion view's `update`
     * returns early when query, text and range are unchanged, so `items` is
     * not asked again.
     */
    const requestEmoji = (): void => {
      if (emojiRequested) return;
      emojiRequested = true;
      void ensureEmojiLoaded().then(() => {
        emojiRequested = false;
        if (editor.isDestroyed || loadedEmoji() === null) return;
        editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
      });
    };

    return [
      Suggestion<SymbolSuggestionItem>({
        editor,
        pluginKey: symbolSuggestPluginKey,
        ...SYMBOL_TRIGGER,
        allow: ({ state, range }) => symbolSuggestAllowed(state, range),
        // ‼️ Decides `active`, which swallows Esc whether or not a menu is drawn
        // (@tiptap/suggestion plugin/props.ts) and which the vim Esc arbiter
        // reads. So an empty result must be decided here, never in the renderer.
        shouldShow: ({ editor: ed, query, range, transaction }) => {
          if (query.length === 0) return false;
          if (insideMathEdit(ed, transaction, range)) return false;
          const emoji = loadedEmoji();
          if (emoji === null) requestEmoji();
          return (
            query.length >= SYMBOL_MIN_QUERY && hasSymbolMatch(query, emoji)
          );
        },
        items: ({ query }) => searchSymbols(query, loadedEmoji(), locale()),
        command: ({ editor: ed, range, props }) => {
          const before = ed.state.doc;
          insertSymbol(ed, range, props.char);
          // §377 The symbol picker's "Recently used" section reads this. The
          // `:` ranking does not — the same query keeps the same order.
          // Recorded only when the document took the pick, as the slash
          // entrance does (symbol-picker-action.ts): a filtered transaction
          // writes nothing.
          if (ed.state.doc !== before) {
            useSettingsStore.getState().pushRecentSymbol(props.char);
          }
        },
        render: createSuggestionRenderer<SymbolSuggestionItem>({
          component: SymbolMenuList,
          menuHeight: SYMBOL_MENU_HEIGHT,
          popupClass: "symbol-menu-popup",
        }),
      }),
    ];
  },
});
