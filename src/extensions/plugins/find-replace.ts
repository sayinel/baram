// §5.6 Find/Replace — ProseMirror Plugin with Decoration.inline
// Highlights all matches in the document. Active match uses a distinct style.
// Meta-based state updates (same pattern as ghost-text.ts).

import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { extractTextWithPositions } from "./find-replace-text";
import { withVimExternalEdit } from "./vim/vim-keys";

// ── Plugin key ────────────────────────────────────────────────────────

export const findReplacePluginKey = new PluginKey("findReplace");

// ── State interface ───────────────────────────────────────────────────

export interface FindReplaceMatch {
  from: number;
  to: number;
}

export interface FindReplaceState {
  activeMatchIndex: number;
  caseSensitive: boolean;
  decorations: DecorationSet;
  matches: FindReplaceMatch[];
  replaceWith: string;
  searchTerm: string;
  useRegex: boolean;
  wholeWord: boolean;
}

// ── Match computation ─────────────────────────────────────────────────

/** Maximum character length for user-supplied regex patterns (ReDoS mitigation) */
const MAX_REGEX_PATTERN_LENGTH = 500;

/** Build a regex from the search options */
export function buildSearchRegex(
  term: string,
  caseSensitive: boolean,
  useRegex: boolean,
  wholeWord: boolean,
): null | RegExp {
  if (!term) return null;

  let pattern: string;
  if (useRegex) {
    // Reject overly long patterns to prevent ReDoS (catastrophic backtracking)
    if (term.length > MAX_REGEX_PATTERN_LENGTH) return null;
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
  const regex = buildSearchRegex(
    searchTerm,
    caseSensitive,
    useRegex,
    wholeWord,
  );
  if (!regex) return [];

  const { text, posMap } = extractTextWithPositions(doc);
  const matches: FindReplaceMatch[] = [];

  let m: null | RegExpExecArray;
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
  const matches = findMatches(
    doc,
    searchTerm,
    caseSensitive,
    useRegex,
    wholeWord,
  );
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
  | { type: "clear" }
  | { type: "nextMatch" }
  | { type: "prevMatch" }
  | { type: "setActiveIndex"; value: number }
  | { type: "setReplaceWith"; value: string }
  | { type: "setSearchTerm"; value: string }
  | { type: "toggleCaseSensitive" }
  | { type: "toggleRegex" }
  | { type: "toggleWholeWord" };

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
          apply(
            tr: Transaction,
            prev: FindReplaceState,
            _oldState: EditorState,
            newState: EditorState,
          ): FindReplaceState {
            const meta = tr.getMeta(findReplacePluginKey) as
              FindReplaceMeta | undefined;

            if (meta) {
              switch (meta.type) {
                case "clear":
                  return EMPTY_STATE;

                case "nextMatch": {
                  if (prev.matches.length === 0) return prev;
                  const nextIdx =
                    (prev.activeMatchIndex + 1) % prev.matches.length;
                  return {
                    ...prev,
                    activeMatchIndex: nextIdx,
                    decorations: buildDecorations(
                      newState.doc,
                      prev.matches,
                      nextIdx,
                    ),
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
                    decorations: buildDecorations(
                      newState.doc,
                      prev.matches,
                      prevIdx,
                    ),
                  };
                }

                case "setActiveIndex": {
                  const idx = meta.value;
                  if (idx < 0 || idx >= prev.matches.length) return prev;
                  return {
                    ...prev,
                    activeMatchIndex: idx,
                    decorations: buildDecorations(
                      newState.doc,
                      prev.matches,
                      idx,
                    ),
                  };
                }

                case "setReplaceWith":
                  return { ...prev, replaceWith: meta.value };

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
            const pluginState = findReplacePluginKey.getState(
              state,
            ) as FindReplaceState;
            return pluginState?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

// ── Find 가 닫힌 동안의 상태 설치 (#792) ─────────────────────────────

// Find 막대가 열려 있는가. 앱 창마다 Find 상태는 하나이고(use-find-replace-routing),
// MarkdownSurface 가 그 값을 여기 적는다.
let findOpen = false;

export function setFindOpen(open: boolean): void {
  findOpen = open;
}

/**
 * 통째로 설치할 상태가 검색을 들고 있는데 Find 가 닫혀 있으면, 검색을 지운 상태를 돌려준다.
 *
 * 탭마다 캐시해 둔 EditorState 는 캐시할 때의 검색을 싣고 있다. A 에서 검색하고 Find 를 연 채
 * B 로 가서 닫으면 지워지는 것은 B 의 상태뿐이라, A 로 돌아와 캐시를 설치하면 보이지 않는
 * 검색이 되살아나 편집마다 match 를 다시 구한다. `view.updateState` 는 transaction 을 거치지
 * 않아 MarkdownSurface 의 닫힘 effect 도 이것을 못 본다. 그래서 설치의 관문인
 * `replaceEditorStateWithVim` 이 이것을 부른다.
 */
export function withoutClosedSearch(state: EditorState): EditorState {
  if (findOpen) return state;
  const ps = findReplacePluginKey.getState(state) as
    FindReplaceState | undefined;
  if (ps === undefined || ps === EMPTY_STATE) return state;
  return state.apply(
    state.tr
      .setMeta(findReplacePluginKey, {
        type: "clear",
      } satisfies FindReplaceMeta)
      .setMeta("addToHistory", false),
  );
}

// ── Helper command dispatchers ────────────────────────────────────────
// These are convenience functions for use by the UI component.

export function dispatchClearSearch(view: {
  dispatch: (tr: Transaction) => void;
  state: EditorState;
}) {
  // 이미 비어 있으면 dispatch 하지 않는다 — MarkdownSurface 가 Find 가 닫혀 있는 동안
  // 편집기가 바뀔 때마다 부른다.
  if (findReplacePluginKey.getState(view.state) === EMPTY_STATE) return;
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "clear",
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchNextMatch(view: {
  dispatch: (tr: Transaction) => void;
  state: EditorState;
}) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "nextMatch",
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchPrevMatch(view: {
  dispatch: (tr: Transaction) => void;
  state: EditorState;
}) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "prevMatch",
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

/** Replace all matches at once */
export function dispatchReplaceAll(view: {
  dispatch: (tr: Transaction) => void;
  state: EditorState;
}) {
  const pluginState = findReplacePluginKey.getState(
    view.state,
  ) as FindReplaceState;
  if (!pluginState || pluginState.matches.length === 0) return;

  // Replace from last to first so positions remain valid
  const sorted = [...pluginState.matches].sort((a, b) => b.from - a.from);
  let tr = view.state.tr;
  for (const match of sorted) {
    tr = tr.insertText(pluginState.replaceWith, match.from, match.to);
  }
  view.dispatch(withVimExternalEdit(tr));
}

/** Replace the current active match and advance to the next */
export function dispatchReplaceCurrent(view: {
  dispatch: (tr: Transaction) => void;
  state: EditorState;
}) {
  const pluginState = findReplacePluginKey.getState(
    view.state,
  ) as FindReplaceState;
  if (
    !pluginState ||
    pluginState.matches.length === 0 ||
    pluginState.activeMatchIndex < 0
  )
    return;

  const match = pluginState.matches[pluginState.activeMatchIndex];
  if (!match) return;

  const tr = view.state.tr.insertText(
    pluginState.replaceWith,
    match.from,
    match.to,
  );
  // The doc change will trigger recomputation in the plugin apply
  view.dispatch(withVimExternalEdit(tr));
}

export function dispatchSetReplaceWith(
  view: { dispatch: (tr: Transaction) => void; state: EditorState },
  term: string,
) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "setReplaceWith",
    value: term,
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchSetSearchTerm(
  view: { dispatch: (tr: Transaction) => void; state: EditorState },
  term: string,
) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "setSearchTerm",
    value: term,
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchToggleCaseSensitive(view: {
  dispatch: (tr: Transaction) => void;
  state: EditorState;
}) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "toggleCaseSensitive",
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchToggleRegex(view: {
  dispatch: (tr: Transaction) => void;
  state: EditorState;
}) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "toggleRegex",
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function dispatchToggleWholeWord(view: {
  dispatch: (tr: Transaction) => void;
  state: EditorState;
}) {
  const tr = view.state.tr.setMeta(findReplacePluginKey, {
    type: "toggleWholeWord",
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}
