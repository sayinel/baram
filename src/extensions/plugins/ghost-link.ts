// §11.5.2 Ghost Link — ProseMirror Plugin for suggested wikilink decorations
// Shows faint blue dotted underline on entity matches from dictionary.
// Tab: convert to [[wikilink]], Esc: dismiss suggestion.
// Frequency control: max 3 per paragraph, 30s cooldown, min 20 char paragraph.

import type { Node as PmNode } from "@tiptap/pm/model";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { extractEntities } from "../../utils/entity-extractor";

// ── Constants ─────────────────────────────────────────────────────────

export const GHOST_LINK_CSS_CLASS = "ghost-link";
export const MAX_SUGGESTIONS_PER_PARAGRAPH = 3;
export const MIN_PARAGRAPH_LENGTH = 20;
export const SUGGESTION_COOLDOWN_MS = 30_000;

// ── Plugin Key ────────────────────────────────────────────────────────

export const ghostLinkPluginKey = new PluginKey("ghostLink");

// ── Types ─────────────────────────────────────────────────────────────

export type GhostLinkMeta =
  | { dictionary: Set<string>; type: "updateDictionary" }
  | { target: string; type: "dismiss" }
  | { type: "clearAll" }
  | { type: "refresh" };

export interface GhostLinkState {
  decorationSet: DecorationSet;
  dictionary: Set<string>;
  dismissed: Set<string>;
  suggestions: GhostLinkSuggestion[];
}

export interface GhostLinkSuggestion {
  display: string;
  from: number;
  target: string;
  to: number;
}

// ── Core logic: compute suggestions & decorations ─────────────────────

export function computeGhostLinkDecorations(
  doc: PmNode,
  dictionary: Set<string>,
  dismissed: Set<string>,
): { decorationSet: DecorationSet; suggestions: GhostLinkSuggestion[] } {
  if (dictionary.size === 0) {
    return { decorationSet: DecorationSet.empty, suggestions: [] };
  }

  const allSuggestions: GhostLinkSuggestion[] = [];
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return true;

    // Extract text content from the paragraph
    let paragraphText = "";
    node.descendants((child) => {
      if (child.isText && child.text) {
        paragraphText += child.text;
      }
      return true;
    });

    // Skip short paragraphs
    if (paragraphText.length < MIN_PARAGRAPH_LENGTH) return false;

    // Find entity matches (already handles wikilink exclusion & dedup)
    const activeDictionary = new Set(
      [...dictionary].filter((term) => !dismissed.has(term)),
    );
    const entities = extractEntities(paragraphText, activeDictionary);

    // Limit per paragraph
    const limited = entities.slice(0, MAX_SUGGESTIONS_PER_PARAGRAPH);

    for (const entity of limited) {
      // Find the entity's position within the paragraph text
      const lowerText = paragraphText.toLowerCase();
      const lowerEntity = entity.toLowerCase();
      const textOffset = lowerText.indexOf(lowerEntity);
      if (textOffset === -1) continue;

      // Map text offset to ProseMirror position within the paragraph
      // pos is the position of the paragraph node itself;
      // pos + 1 is the start of content inside the paragraph
      const from = pos + 1 + textOffset;
      const to = from + entity.length;

      const suggestion: GhostLinkSuggestion = {
        display: entity,
        from,
        target: entity,
        to,
      };
      allSuggestions.push(suggestion);

      decorations.push(
        Decoration.inline(from, to, {
          class: GHOST_LINK_CSS_CLASS,
          "data-display": entity,
          "data-ghost-link": "true",
          "data-target": entity,
          nodeName: "span",
        }),
      );
    }

    return false; // Don't descend into paragraph children (already handled)
  });

  return {
    decorationSet:
      decorations.length > 0
        ? DecorationSet.create(doc, decorations)
        : DecorationSet.empty,
    suggestions: allSuggestions,
  };
}

// ── Cooldown ──────────────────────────────────────────────────────────
// §perf-large-file C3.4: Per-view cooldown via WeakMap so two concurrent
// editor views (C3.5 dual-editor) track cooldown independently.

const _cooldownByView = new WeakMap<
  import("@tiptap/pm/view").EditorView,
  number
>();

export function recordSuggestionTime(
  view?: import("@tiptap/pm/view").EditorView,
): void {
  if (view) {
    _cooldownByView.set(view, Date.now());
  }
}

export function resetCooldown(
  view?: import("@tiptap/pm/view").EditorView,
): void {
  if (view) {
    _cooldownByView.delete(view);
  }
}

export function shouldThrottle(
  view?: import("@tiptap/pm/view").EditorView,
): boolean {
  if (!view) return false;
  const last = _cooldownByView.get(view) ?? 0;
  return Date.now() - last < SUGGESTION_COOLDOWN_MS;
}

/** @internal — exported for testing only */
export { _cooldownByView };

// ── Empty state ───────────────────────────────────────────────────────

const EMPTY_STATE: GhostLinkState = {
  decorationSet: DecorationSet.empty,
  dictionary: new Set(),
  dismissed: new Set(),
  suggestions: [],
};

// ── Tiptap Extension ──────────────────────────────────────────────────

export const GhostLink = Extension.create({
  name: "ghostLink",

  addProseMirrorPlugins() {
    // §perf-large-file C3.4: capture editor view for per-view cooldown tracking
    const editorView = this.editor.view;
    return [
      new Plugin({
        key: ghostLinkPluginKey,
        state: {
          init(): GhostLinkState {
            return EMPTY_STATE;
          },
          apply(tr, prev, _oldState, newState): GhostLinkState {
            const meta = tr.getMeta(ghostLinkPluginKey) as
              | GhostLinkMeta
              | undefined;

            if (meta) {
              switch (meta.type) {
                case "clearAll":
                  return {
                    ...prev,
                    decorationSet: DecorationSet.empty,
                    suggestions: [],
                  };

                case "dismiss": {
                  const newDismissed = new Set(prev.dismissed);
                  newDismissed.add(meta.target);
                  const dismissResult = computeGhostLinkDecorations(
                    newState.doc,
                    prev.dictionary,
                    newDismissed,
                  );
                  return {
                    ...prev,
                    decorationSet: dismissResult.decorationSet,
                    dismissed: newDismissed,
                    suggestions: dismissResult.suggestions,
                  };
                }

                case "refresh": {
                  if (shouldThrottle(editorView)) return prev;
                  const refreshResult = computeGhostLinkDecorations(
                    newState.doc,
                    prev.dictionary,
                    prev.dismissed,
                  );
                  if (refreshResult.suggestions.length > 0) {
                    recordSuggestionTime(editorView);
                  }
                  return {
                    ...prev,
                    decorationSet: refreshResult.decorationSet,
                    suggestions: refreshResult.suggestions,
                  };
                }

                case "updateDictionary": {
                  const updateResult = computeGhostLinkDecorations(
                    newState.doc,
                    meta.dictionary,
                    prev.dismissed,
                  );
                  recordSuggestionTime(editorView);
                  return {
                    ...prev,
                    decorationSet: updateResult.decorationSet,
                    dictionary: meta.dictionary,
                    suggestions: updateResult.suggestions,
                  };
                }
              }
            }

            // On doc change, remap decorations
            if (tr.docChanged && prev.suggestions.length > 0) {
              return {
                ...prev,
                decorationSet: prev.decorationSet.map(tr.mapping, tr.doc),
              };
            }

            return prev;
          },
        },
        props: {
          decorations(state) {
            const pluginState = ghostLinkPluginKey.getState(
              state,
            ) as GhostLinkState;
            return pluginState?.decorationSet ?? DecorationSet.empty;
          },
          handleKeyDown(view, event) {
            const pluginState = ghostLinkPluginKey.getState(
              view.state,
            ) as GhostLinkState;
            if (!pluginState || pluginState.suggestions.length === 0) {
              return false;
            }

            // Tab: convert the nearest ghost link to an actual [[wikilink]]
            if (event.key === "Tab" && !event.shiftKey) {
              const { from: cursorPos } = view.state.selection;

              // Find the closest suggestion to cursor
              let closest: GhostLinkSuggestion | null = null;
              let minDist = Infinity;
              for (const s of pluginState.suggestions) {
                const dist = Math.min(
                  Math.abs(cursorPos - s.from),
                  Math.abs(cursorPos - s.to),
                );
                if (dist < minDist) {
                  minDist = dist;
                  closest = s;
                }
              }

              if (!closest) return false;

              event.preventDefault();

              // Check if the wikilink node type exists in the schema
              const wikilinkType =
                view.state.schema.nodes["wikilink"] ??
                view.state.schema.nodes["wikiLink"];

              let tabTr;
              if (wikilinkType) {
                // Replace text with a wikilink node
                const node = wikilinkType.create({
                  display: closest.display,
                  target: closest.target,
                });
                tabTr = view.state.tr.replaceWith(
                  closest.from,
                  closest.to,
                  node,
                );
              } else {
                // Fallback: insert [[target]] as text
                tabTr = view.state.tr.insertText(
                  `[[${closest.target}]]`,
                  closest.from,
                  closest.to,
                );
              }

              // Trigger recomputation via meta
              tabTr.setMeta(ghostLinkPluginKey, {
                dictionary: pluginState.dictionary,
                type: "updateDictionary",
              } satisfies GhostLinkMeta);

              view.dispatch(tabTr);
              return true;
            }

            // Escape: dismiss all current suggestions
            if (event.key === "Escape") {
              event.preventDefault();
              view.dispatch(
                view.state.tr.setMeta(ghostLinkPluginKey, {
                  type: "clearAll",
                } satisfies GhostLinkMeta),
              );
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
