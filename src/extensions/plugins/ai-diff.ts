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

export interface Hunk {
  /** Character offset in originalText */
  originalStart: number;
  originalEnd: number;
  /** The replacement text for this hunk */
  replacement: string;
  /** Whether this hunk has been accepted */
  accepted: boolean;
  /** Whether this hunk has been rejected */
  rejected: boolean;
}

export interface AIDiffState {
  phase: AIDiffPhase;
  originalFrom: number;
  originalTo: number;
  originalText: string;
  aiText: string;
  hunks: Hunk[];
}

const IDLE_STATE: AIDiffState = {
  phase: "idle",
  originalFrom: 0,
  originalTo: 0,
  originalText: "",
  aiText: "",
  hunks: [],
};

// ── Meta types ────────────────────────────────────────────────────────

export type AIDiffMeta =
  | { type: "start"; from: number; to: number; originalText: string }
  | { type: "streamChunk"; text: string }
  | { type: "streamDone" }
  | { type: "accept" }
  | { type: "reject" }
  | { type: "clear" }
  | { type: "acceptHunk"; index: number }
  | { type: "rejectHunk"; index: number };

// ── Hunk computation ────────────────────────────────────────────────

/**
 * Compute discrete hunks from fast-diff results.
 * Each hunk represents a contiguous change (DELETE and/or INSERT).
 * EQUAL segments are NOT hunks — they separate hunks.
 */
export function computeHunks(originalText: string, aiText: string): Hunk[] {
  const diffs = diff(originalText, aiText);
  const hunks: Hunk[] = [];

  let originalOffset = 0;
  let currentHunk: {
    originalStart: number;
    originalEnd: number;
    replacement: string;
  } | null = null;

  for (const [op, text] of diffs) {
    if (op === diff.EQUAL) {
      // Flush current hunk if any
      if (currentHunk) {
        hunks.push({
          ...currentHunk,
          accepted: false,
          rejected: false,
        });
        currentHunk = null;
      }
      originalOffset += text.length;
    } else if (op === diff.DELETE) {
      if (!currentHunk) {
        currentHunk = {
          originalStart: originalOffset,
          originalEnd: originalOffset,
          replacement: "",
        };
      }
      currentHunk.originalEnd = originalOffset + text.length;
      originalOffset += text.length;
    } else if (op === diff.INSERT) {
      if (!currentHunk) {
        currentHunk = {
          originalStart: originalOffset,
          originalEnd: originalOffset,
          replacement: "",
        };
      }
      currentHunk.replacement += text;
    }
  }

  // Flush trailing hunk
  if (currentHunk) {
    hunks.push({
      ...currentHunk,
      accepted: false,
      rejected: false,
    });
  }

  return hunks;
}

/**
 * Build the final text by applying hunk decisions.
 * For each hunk: accepted → use replacement, rejected → use original.
 * `defaultAccept` controls what happens for undecided hunks (true = accept all).
 */
export function buildTextFromHunks(
  originalText: string,
  hunks: Hunk[],
  defaultAccept: boolean,
): string {
  let result = "";
  let originalOffset = 0;

  for (const hunk of hunks) {
    // Copy unchanged text before this hunk
    if (hunk.originalStart > originalOffset) {
      result += originalText.slice(originalOffset, hunk.originalStart);
    }

    const useReplacement = hunk.accepted || (!hunk.rejected && defaultAccept);
    if (useReplacement) {
      result += hunk.replacement;
    } else {
      // Keep original
      result += originalText.slice(hunk.originalStart, hunk.originalEnd);
    }

    originalOffset = hunk.originalEnd;
  }

  // Copy any remaining original text after the last hunk
  if (originalOffset < originalText.length) {
    result += originalText.slice(originalOffset);
  }

  return result;
}

// ── Decoration builder ───────────────────────────────────────────────

function buildDiffDecorations(
  doc: import("@tiptap/pm/model").Node,
  state: AIDiffState,
): DecorationSet {
  if (state.phase === "idle" || !state.aiText) return DecorationSet.empty;

  const { originalFrom, originalTo, originalText, aiText, hunks } = state;

  // Validate positions
  if (originalFrom < 0 || originalTo > doc.content.size) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  // If we have hunks (completed phase), use per-hunk decorations
  if (hunks.length > 0) {
    // Build per-hunk decorations on the original text range
    for (const hunk of hunks) {
      const hunkDocFrom = originalFrom + hunk.originalStart;
      const hunkDocTo = originalFrom + hunk.originalEnd;

      if (hunk.accepted) {
        // Accepted hunk: show original as strikethrough with accepted style
        if (hunkDocFrom < hunkDocTo) {
          decorations.push(
            Decoration.inline(hunkDocFrom, hunkDocTo, {
              class: "ai-diff-delete ai-diff-hunk-accepted",
            }),
          );
        }
      } else if (hunk.rejected) {
        // Rejected hunk: original text stays, show with rejected marker style
        if (hunkDocFrom < hunkDocTo) {
          decorations.push(
            Decoration.inline(hunkDocFrom, hunkDocTo, {
              class: "ai-diff-hunk-rejected",
            }),
          );
        }
      } else {
        // Pending hunk: strikethrough on deleted original
        if (hunkDocFrom < hunkDocTo) {
          decorations.push(
            Decoration.inline(hunkDocFrom, hunkDocTo, {
              class: "ai-diff-delete",
            }),
          );
        }
      }
    }

    // Widget after original range showing AI text with per-hunk coloring
    const widget = Decoration.widget(
      originalTo,
      () => {
        const container = document.createElement("span");
        container.className = "ai-diff-insert-container";

        const diffs = diff(originalText, aiText);

        // Map each diff segment to its hunk for coloring
        let origOffset = 0;
        for (const [op, text] of diffs) {
          if (op === diff.EQUAL) {
            const span = document.createElement("span");
            span.className = "ai-diff-equal";
            span.textContent = text;
            container.appendChild(span);
            origOffset += text.length;
          } else if (op === diff.DELETE) {
            // DELETE is shown via inline decoration on original text
            origOffset += text.length;
          } else if (op === diff.INSERT) {
            // Find which hunk this INSERT belongs to
            const hunk = hunks.find(
              (h) =>
                h.replacement.includes(text) &&
                origOffset >= h.originalStart &&
                origOffset <= h.originalEnd,
            );

            const span = document.createElement("span");
            if (hunk?.accepted) {
              span.className = "ai-diff-insert ai-diff-hunk-accepted";
            } else if (hunk?.rejected) {
              span.className = "ai-diff-insert ai-diff-hunk-rejected";
              span.style.display = "none";
            } else {
              span.className = "ai-diff-insert";
            }
            span.textContent = text;
            container.appendChild(span);
          }
        }

        return container;
      },
      { side: 1 },
    );
    decorations.push(widget);
  } else {
    // Streaming phase — no hunks yet, use simple diff display
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
  }

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
                    hunks: [],
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
                    hunks: computeHunks(prev.originalText, prev.aiText),
                  };

                case "acceptHunk": {
                  if (prev.phase !== "completed") return prev;
                  const acceptIdx = meta.index;
                  if (acceptIdx < 0 || acceptIdx >= prev.hunks.length) return prev;
                  const acceptedHunks = prev.hunks.map((h, i) =>
                    i === acceptIdx ? { ...h, accepted: true, rejected: false } : h,
                  );
                  return { ...prev, hunks: acceptedHunks };
                }

                case "rejectHunk": {
                  if (prev.phase !== "completed") return prev;
                  const rejectIdx = meta.index;
                  if (rejectIdx < 0 || rejectIdx >= prev.hunks.length) return prev;
                  const rejectedHunks = prev.hunks.map((h, i) =>
                    i === rejectIdx ? { ...h, rejected: true, accepted: false } : h,
                  );
                  return { ...prev, hunks: rejectedHunks };
                }

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

  const { originalFrom, originalTo, originalText, aiText, hunks } = pluginState;
  if (!aiText) {
    dispatchAIDiffClear(view);
    return;
  }

  // Build final text from hunks: accepted hunks use replacement, rejected use original,
  // undecided hunks default to accept (full accept behavior)
  const finalText =
    hunks.length > 0
      ? buildTextFromHunks(originalText, hunks, true)
      : aiText;

  // Replace original text with final text in a single transaction
  const tr = view.state.tr
    .insertText(finalText, originalFrom, originalTo)
    .setMeta(aiDiffPluginKey, { type: "accept" } satisfies AIDiffMeta)
    .setMeta("aiDiffAccept", true);
  view.dispatch(tr);
}

export function dispatchAIDiffAcceptHunk(view: Dispatchable, index: number) {
  const tr = view.state.tr.setMeta(aiDiffPluginKey, {
    type: "acceptHunk",
    index,
  } satisfies AIDiffMeta);
  view.dispatch(tr);
}

export function dispatchAIDiffRejectHunk(view: Dispatchable, index: number) {
  const tr = view.state.tr.setMeta(aiDiffPluginKey, {
    type: "rejectHunk",
    index,
  } satisfies AIDiffMeta);
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
