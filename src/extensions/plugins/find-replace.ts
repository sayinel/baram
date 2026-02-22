// §5.6 Find/Replace — ProseMirror Plugin with Decoration.inline
// Highlights all matches in the document. Active match uses a distinct style.
// Meta-based state updates (same pattern as ghost-text.ts).

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";

// ── Plugin key ────────────────────────────────────────────────────────

export const findReplacePluginKey = new PluginKey("findReplace");

// ── State interface ───────────────────────────────────────────────────

export interface FindReplaceMatch {
  from: number;
  to: number;
}

export interface FindReplaceState {
  searchTerm: string;
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean;
  replaceWith: string;
  activeMatchIndex: number;
  matches: FindReplaceMatch[];
  decorations: DecorationSet;
}

// ── Match computation ─────────────────────────────────────────────────

/** Extract all text content from ProseMirror doc with position mapping */
function extractTextWithPositions(doc: PmNode): { text: string; posMap: number[] } {
  let text = "";
  const posMap: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posMap.push(pos + i);
        text += node.text[i];
      }
    } else if (node.isBlock && text.length > 0 && text[text.length - 1] !== "\n") {
      // Add separator between blocks to avoid matching across them
      posMap.push(-1); // sentinel — not a valid position
      text += "\n";
    }
    return true;
  });

  return { text, posMap };
}

/** Build a regex from the search options */
export function buildSearchRegex(
  term: string,
  caseSensitive: boolean,
  useRegex: boolean,
  wholeWord: boolean,
): RegExp | null {
  if (!term) return null;

  let pattern: string;
  if (useRegex) {
    try {
      // Validate the regex by trying to compile it
      new RegExp(term);
      pattern = term;
    } catch {
      return null; // Invalid regex
    }
  } else {
    // Escape special regex characters for literal search
    pattern = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  if (wholeWord) {
    pattern = `\\b${pattern}\\b`;
  }

  const flags = caseSensitive ? "g" : "gi";
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/** Find all matches in the document */
export function findMatches(
  doc: PmNode,
  searchTerm: string,
  caseSensitive: boolean,
  useRegex: boolean,
  wholeWord: boolean,
): FindReplaceMatch[] {
  const regex = buildSearchRegex(searchTerm, caseSensitive, useRegex, wholeWord);
  if (!regex) return [];

  const { text, posMap } = extractTextWithPositions(doc);
  const matches: FindReplaceMatch[] = [];

  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;

    // Skip matches that span block boundaries (contain sentinel positions)
    let valid = true;
    for (let i = start; i < end; i++) {
      if (posMap[i] === -1) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    if (start < posMap.length && end - 1 < posMap.length) {
      matches.push({
        from: posMap[start],
        to: posMap[end - 1] + 1,
      });
    }

    // Prevent infinite loop for zero-length matches
    if (m[0].length === 0) {
      regex.lastIndex++;
    }
  }

  return matches;
}

/** Build decoration set from matches */
function buildDecorations(
  doc: PmNode,
  matches: FindReplaceMatch[],
  activeIndex: number,
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;

  const decorations = matches.map((match, i) => {
    const className =
      i === activeIndex ? "find-match find-match-active" : "find-match";
    return Decoration.inline(match.from, match.to, { class: className });
  });

  return DecorationSet.create(doc, decorations);
}

/** Compute full state from meta update */
function computeState(
  doc: PmNode,
  searchTerm: string,
  caseSensitive: boolean,
  useRegex: boolean,
  wholeWord: boolean,
  replaceWith: string,
  activeMatchIndex: number,
): FindReplaceState {
  const matches = findMatches(doc, searchTerm, caseSensitive, useRegex, wholeWord);
  // Clamp activeMatchIndex
  const clampedIndex =
    matches.length === 0
      ? -1
      : Math.min(Math.max(activeMatchIndex, 0), matches.length - 1);
  const decorations = buildDecorations(doc, matches, clampedIndex);
  return {
    searchTerm,
    caseSensitive,
    useRegex,
    wholeWord,
    replaceWith,
    activeMatchIndex: clampedIndex,
    matches,
    decorations,
  };
}

// ── Initial state ─────────────────────────────────────────────────────

const EMPTY_STATE: FindReplaceState = {
  searchTerm: "",
  caseSensitive: false,
  useRegex: false,
  wholeWord: false,
  replaceWith: "",
  activeMatchIndex: -1,
  matches: [],
  decorations: DecorationSet.empty,
};

// ── Meta types ────────────────────────────────────────────────────────

export type FindReplaceMeta =
  | { type: "setSearchTerm"; value: string }
  | { type: "setReplaceWith"; value: string }
  | { type: "toggleCaseSensitive" }
  | { type: "toggleRegex" }
  | { type: "toggleWholeWord" }
  | { type: "nextMatch" }
  | { type: "prevMatch" }
  | { type: "setActiveIndex"; value: number }
  | { type: "clear" };

// ── Tiptap Extension ──────────────────────────────────────────────────

export const FindReplace = Extension.create({
  name: "findReplace",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findReplacePluginKey,
        state: {
          init(): FindReplaceState {
            return EMPTY_STATE;
          },
          apply(tr: Transaction, prev: FindReplaceState, _oldState: EditorState, newState: EditorState): FindReplaceState {
            const meta = tr.getMeta(findReplacePluginKey) as FindReplaceMeta | undefined;

            if (meta) {
              switch (meta.type) {
                case "setSearchTerm":
                  return computeState(
                    newState.doc,
                    meta.value,
                    prev.caseSensitive,
                    prev.useRegex,
                    prev.wholeWord,
                    prev.replaceWith,
                    0, // Reset to first match
                  );

                case "setReplaceWith":
                  return { ...prev, replaceWith: meta.value };

                case "toggleCaseSensitive":
                  return computeState(
                    newState.doc,
                    prev.searchTerm,
                    !prev.caseSensitive,
                    prev.useRegex,
                    prev.wholeWord,
                    prev.replaceWith,
                    0,
                  );

                case "toggleRegex":
                  return computeState(
                    newState.doc,
                    prev.searchTerm,
                    prev.caseSensitive,
                    !prev.useRegex,
                    prev.wholeWord,
                    prev.replaceWith,
                    0,
                  );

                case "toggleWholeWord":
                  return computeState(
                    newState.doc,
                    prev.searchTerm,
                    prev.caseSensitive,
                    prev.useRegex,
                    !prev.wholeWord,
                    prev.replaceWith,
                    0,
                  );

                case "nextMatch": {
                  if (prev.matches.length === 0) return prev;
                  const nextIdx = (prev.activeMatchIndex + 1) % prev.matches.length;
                  return {
                    ...prev,
                    activeMatchIndex: nextIdx,
                    decorations: buildDecorations(newState.doc, prev.matches, nextIdx),
                  };
                }

                case "prevMatch": {
                  if (prev.matches.length === 0) return prev;
                  const prevIdx =
                    (prev.activeMatchIndex - 1 + prev.matches.length) %
                    prev.matches.length;
                  return {
                    ...prev,
                    activeMatchIndex: prevIdx,
                    decorations: buildDecorations(newState.doc, prev.matches, prevIdx),
                  };
                }

                case "setActiveIndex": {
                  const idx = meta.value;
                  if (idx < 0 || idx >= prev.matches.length) return prev;
                  return {
                    ...prev,
                    activeMatchIndex: idx,
                    decorations: buildDecorations(newState.doc, prev.matches, idx),
                  };
                }

                case "clear":
                  return EMPTY_STATE;
              }
            }

            // On doc change, recompute matches if search is active
            if (tr.docChanged && prev.searchTerm) {
              return computeState(
                newState.doc,
                prev.searchTerm,
                prev.caseSensitive,
                prev.useRegex,
                prev.wholeWord,
                prev.replaceWith,
                prev.activeMatchIndex,
              );
            }

            return prev;
          },
        },
        props: {
          decorations(state: EditorState) {
            const pluginState = findReplacePluginKey.getState(state) as FindReplaceState;
            return pluginState?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

// ── Helper command dispatchers ────────────────────────────────────────
// These are convenience functions for use by the UI component.

export function dispatchSetSearchTerm(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  term: string,
) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "setSearchTerm",
    value: term,
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchSetReplaceWith(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  term: string,
) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "setReplaceWith",
    value: term,
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchToggleCaseSensitive(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "toggleCaseSensitive",
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchToggleRegex(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "toggleRegex",
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchToggleWholeWord(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "toggleWholeWord",
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchNextMatch(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "nextMatch",
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchPrevMatch(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "prevMatch",
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchClearSearch(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "clear",
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

/** Replace the current active match and advance to the next */
export function dispatchReplaceCurrent(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
) {
  const pluginState = findReplacePluginKey.getState(view.state) as FindReplaceState;
  if (!pluginState || pluginState.matches.length === 0 || pluginState.activeMatchIndex < 0) return;

  const match = pluginState.matches[pluginState.activeMatchIndex];
  if (!match) return;

  const tr = view.state.tr.insertText(pluginState.replaceWith, match.from, match.to);
  // The doc change will trigger recomputation in the plugin apply
  view.dispatch(tr);
}

/** Replace all matches at once */
export function dispatchReplaceAll(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
) {
  const pluginState = findReplacePluginKey.getState(view.state) as FindReplaceState;
  if (!pluginState || pluginState.matches.length === 0) return;

  // Replace from last to first so positions remain valid
  const sorted = [...pluginState.matches].sort((a, b) => b.from - a.from);
  let tr = view.state.tr;
  for (const match of sorted) {
    tr = tr.insertText(pluginState.replaceWith, match.from, match.to);
  }
  view.dispatch(tr);
}
