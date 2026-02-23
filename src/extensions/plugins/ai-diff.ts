// §6.2 AI Diff — ProseMirror Plugin for inline AI editing with diff preview
// Shows original text with strikethrough (red) and AI-generated text (green).
// Original document is NOT modified until accept. Escape = reject.
// Pattern: PluginKey + meta-based state (ghost-text) + Decoration.inline (find-replace)

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import diff from "fast-diff";

// ── Plugin key ────────────────────────────────────────────────────────

export const aiDiffPluginKey = new PluginKey("aiDiff");

// ── State types ───────────────────────────────────────────────────────

export type AIDiffPhase = "idle" | "streaming" | "completed";

export interface AIDiffState {
  phase: AIDiffPhase;
  originalFrom: number;
  originalTo: number;
  originalText: string;
  aiText: string;
}

const IDLE_STATE: AIDiffState = {
  phase: "idle",
  originalFrom: 0,
  originalTo: 0,
  originalText: "",
  aiText: "",
};

// ── Meta types ────────────────────────────────────────────────────────

export type AIDiffMeta =
  | { type: "start"; from: number; to: number; originalText: string }
  | { type: "streamChunk"; text: string }
  | { type: "streamDone" }
  | { type: "accept" }
  | { type: "reject" }
  | { type: "clear" };

// ── Decoration builder ───────────────────────────────────────────────

function buildDiffDecorations(
  doc: import("@tiptap/pm/model").Node,
  state: AIDiffState,
): DecorationSet {
  if (state.phase === "idle" || !state.aiText) return DecorationSet.empty;

  const { originalFrom, originalTo, originalText, aiText } = state;

  // Validate positions
  if (originalFrom < 0 || originalTo > doc.content.size) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  // Strikethrough on original text range
  if (originalFrom < originalTo) {
    decorations.push(
      Decoration.inline(originalFrom, originalTo, {
        class: "ai-diff-delete",
      }),
    );
  }

  // Widget after original range showing AI text with char-level diff
  const widget = Decoration.widget(
    originalTo,
    () => {
      const container = document.createElement("span");
      container.className = "ai-diff-insert-container";

      // Use fast-diff for character-level diff visualization
      const diffs = diff(originalText, aiText);

      for (const [op, text] of diffs) {
        if (op === diff.INSERT) {
          const span = document.createElement("span");
          span.className = "ai-diff-insert";
          span.textContent = text;
          container.appendChild(span);
        } else if (op === diff.EQUAL) {
          const span = document.createElement("span");
          span.className = "ai-diff-equal";
          span.textContent = text;
          container.appendChild(span);
        }
        // DELETE is already shown via inline decoration on original text
      }

      return container;
    },
    { side: 1 },
  );

  decorations.push(widget);

  return DecorationSet.create(doc, decorations);
}

// ── Tiptap Extension ─────────────────────────────────────────────────

export const AIDiff = Extension.create({
  name: "aiDiff",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiDiffPluginKey,
        state: {
          init(): AIDiffState {
            return IDLE_STATE;
          },
          apply(
            tr: Transaction,
            prev: AIDiffState,
            _oldState: EditorState,
            _newState: EditorState,
          ): AIDiffState {
            const meta = tr.getMeta(aiDiffPluginKey) as AIDiffMeta | undefined;

            if (meta) {
              switch (meta.type) {
                case "start":
                  return {
                    phase: "streaming",
                    originalFrom: meta.from,
                    originalTo: meta.to,
                    originalText: meta.originalText,
                    aiText: "",
                  };

                case "streamChunk":
                  if (prev.phase === "idle") return prev;
                  return {
                    ...prev,
                    aiText: prev.aiText + meta.text,
                  };

                case "streamDone":
                  if (prev.phase === "idle") return prev;
                  return {
                    ...prev,
                    phase: "completed",
                  };

                case "accept":
                  // Accept is handled by the dispatch helper (replaces doc text)
                  // Plugin just resets to idle
                  return IDLE_STATE;

                case "reject":
                case "clear":
                  return IDLE_STATE;
              }
            }

            // External doc changes while active → force clear for safety
            if (tr.docChanged && prev.phase !== "idle") {
              // Check if the change is from accept (we set a flag on accept)
              const isAcceptTr = tr.getMeta("aiDiffAccept");
              if (isAcceptTr) return IDLE_STATE;
              // External edit → clear
              return IDLE_STATE;
            }

            return prev;
          },
        },
        props: {
          decorations(state: EditorState) {
            const pluginState = aiDiffPluginKey.getState(state) as AIDiffState;
            if (!pluginState || pluginState.phase === "idle") {
              return DecorationSet.empty;
            }
            return buildDiffDecorations(state.doc, pluginState);
          },
          handleKeyDown(view: EditorView, event: KeyboardEvent) {
            const pluginState = aiDiffPluginKey.getState(
              view.state,
            ) as AIDiffState;
            if (!pluginState || pluginState.phase === "idle") return false;

            // Escape → reject
            if (event.key === "Escape") {
              event.preventDefault();
              dispatchAIDiffReject(view);
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});

// ── Dispatch helpers ─────────────────────────────────────────────────

type Dispatchable = { state: EditorState; dispatch: (tr: Transaction) => void };

export function dispatchAIDiffStart(
  view: Dispatchable,
  from: number,
  to: number,
  originalText: string,
) {
  const tr = view.state.tr.setMeta(aiDiffPluginKey, {
    type: "start",
    from,
    to,
    originalText,
  } satisfies AIDiffMeta);
  view.dispatch(tr);
}

export function dispatchAIDiffChunk(view: Dispatchable, text: string) {
  const tr = view.state.tr.setMeta(aiDiffPluginKey, {
    type: "streamChunk",
    text,
  } satisfies AIDiffMeta);
  view.dispatch(tr);
}

export function dispatchAIDiffDone(view: Dispatchable) {
  const tr = view.state.tr.setMeta(aiDiffPluginKey, {
    type: "streamDone",
  } satisfies AIDiffMeta);
  view.dispatch(tr);
}

export function dispatchAIDiffAccept(view: Dispatchable) {
  const pluginState = aiDiffPluginKey.getState(view.state) as AIDiffState;
  if (!pluginState || pluginState.phase === "idle") return;

  const { originalFrom, originalTo, aiText } = pluginState;
  if (!aiText) {
    dispatchAIDiffClear(view);
    return;
  }

  // Replace original text with AI text in a single transaction
  const tr = view.state.tr
    .insertText(aiText, originalFrom, originalTo)
    .setMeta(aiDiffPluginKey, { type: "accept" } satisfies AIDiffMeta)
    .setMeta("aiDiffAccept", true);
  view.dispatch(tr);
}

export function dispatchAIDiffReject(view: Dispatchable) {
  const tr = view.state.tr.setMeta(aiDiffPluginKey, {
    type: "reject",
  } satisfies AIDiffMeta);
  view.dispatch(tr);
}

export function dispatchAIDiffClear(view: Dispatchable) {
  const tr = view.state.tr.setMeta(aiDiffPluginKey, {
    type: "clear",
  } satisfies AIDiffMeta);
  view.dispatch(tr);
}
