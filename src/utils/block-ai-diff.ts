// §11.2.3 Block AI Diff — Streaming diff preview panel for block-level AI actions
// Shows original vs AI text with inline diff, Accept/Reject controls.
// DOM-based (like showPrompt) so it works from both React and plain PM NodeViews.

import type { Editor } from "@tiptap/core";

import diff from "fast-diff";

import { withVimExternalEdit } from "../extensions/plugins/vim/vim-keys";
import { llmCancel, llmComplete } from "../ipc/invoke";
import { useAIStore } from "../stores/ai/ai";
import { registerEditorMutationTask } from "./editor/mutation-tasks";
import { createLLMStream } from "./llm-stream";
import { logger } from "./logger";
import { getConfigForTask } from "./model-selection";
import { getFilePrivacy, isLLMAllowed } from "./privacy-check";

// ── Apply result to the target block ────────────────────────────────

interface DiffPanel {
  /** Settle a pending decision as "reject" and tear the overlay down. */
  abort: () => void;
  remove: () => void;
  setError: (msg: string) => void;
  showActions: () => void;
  updateDiff: (original: string, ai: string) => void;
  waitForDecision: () => Promise<"accept" | "reject">;
}

// ── Strip code fences ───────────────────────────────────────────────

/**
 * Apply the AI result text to the target block.
 * Handles both text-in-document blocks and attribute-based blocks.
 */
export function applyBlockAIResult(
  editor: Editor,
  targetPos: number,
  aiText: string,
): void {
  const node = editor.state.doc.nodeAt(targetPos);
  if (!node) return;

  const cleaned = stripCodeFences(aiText, node.type.name);
  const typeName = node.type.name;

  switch (typeName) {
    case "codeBlock":
    case "heading":
    case "paragraph": {
      // Text content is in the document
      const from = targetPos + 1;
      const to = targetPos + node.nodeSize - 1;
      editor.view.dispatch(
        withVimExternalEdit(editor.state.tr.insertText(cleaned, from, to)),
      );
      break;
    }
    case "image": {
      // Update alt text attribute
      editor.view.dispatch(
        withVimExternalEdit(
          editor.state.tr.setNodeMarkup(targetPos, undefined, {
            ...node.attrs,
            alt: cleaned,
          }),
        ),
      );
      break;
    }
    case "mathBlock": {
      // Formula stored in attribute
      editor.view.dispatch(
        withVimExternalEdit(
          editor.state.tr.setNodeMarkup(targetPos, undefined, {
            ...node.attrs,
            formula: cleaned,
          }),
        ),
      );
      break;
    }
    case "mermaidBlock":
    case "svgBlock": {
      // Code/markup stored in attribute
      editor.view.dispatch(
        withVimExternalEdit(
          editor.state.tr.setNodeMarkup(targetPos, undefined, {
            ...node.attrs,
            code: cleaned,
          }),
        ),
      );
      break;
    }
    default: {
      // Fallback: replace text content
      const from = targetPos + 1;
      const to = targetPos + node.nodeSize - 1;
      if (from < to) {
        editor.view.dispatch(
          withVimExternalEdit(editor.state.tr.insertText(cleaned, from, to)),
        );
      }
    }
  }
}

// ── Streaming diff panel ────────────────────────────────────────────

/**
 * Execute a block AI command with streaming diff preview.
 * Creates a DOM panel showing real-time diff, resolves when user accepts or rejects.
 */
export async function executeBlockAIWithDiff(
  editor: Editor,
  targetPos: number,
  originalText: string,
  prompt: string,
  systemPrompt: string,
): Promise<void> {
  const store = useAIStore.getState();
  const inlineCfg = getConfigForTask("inline-edit");

  if (!inlineCfg.configured && inlineCfg.provider !== "ollama") {
    logger.error("Block AI diff: no API key configured");
    return;
  }

  const filePrivacy = getFilePrivacy(editor);
  if (!isLLMAllowed(store.privacyMode, inlineCfg.provider, filePrivacy)) {
    logger.error("Block AI diff: blocked by privacy settings");
    return;
  }

  // Position the panel near the target block
  const blockDom = editor.view.nodeDOM(targetPos);
  const anchorRect =
    blockDom instanceof HTMLElement
      ? blockDom.getBoundingClientRect()
      : undefined;

  // Create the diff panel
  const panel = createDiffPanel(originalText, anchorRect);

  const requestId = `block_ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  let aiText = "";
  let completed = false;

  // §298 §12-9b (design §5c): tokens only paint the DOM panel, but the
  // APPLY lands after the dialog resolves — an unbounded async gap. A dead
  // task (state install / vim mode exit) must not touch the editor.
  const task = registerEditorMutationTask(editor.view);

  // PRE-EXISTING DEFECT (review R10): the panel is on screen BEFORE the
  // stream is set up, and every way to dismiss it — Accept/Reject clicks,
  // Escape, backdrop mousedown — is only wired inside waitForDecision().
  // If createLLMStream rejects (say the second listen() fails) the old code
  // threw straight out, leaving a z-index 9999 overlay covering the whole
  // app with no affordance to close it. Everything from here on is
  // exception-safe: the finally always tears the panel and task down.
  let cleanupStream: (() => void) | undefined;
  try {
    cleanupStream = await createLLMStream(requestId, {
      onToken: (token) => {
        aiText += token;
        panel.updateDiff(originalText, aiText);
      },
      onDone: () => {
        completed = true;
        panel.updateDiff(originalText, aiText);
        panel.showActions();
      },
      onError: (error) => {
        logger.error("Block AI diff error:", error);
        completed = true;
        panel.setError(error);
        panel.showActions();
      },
    });
    const stopStream = cleanupStream;
    task.addCleanup(() => {
      stopStream(); // idempotent
      llmCancel(requestId).catch(() => {});
      // Invalidation can also land while we are parked on waitForDecision.
      // Without this the overlay would sit on top of the replacing tab with
      // its "Streaming…" header and the execute promise would never settle.
      panel.abort();
    });

    // Final gate before the outbound request: if the task died while
    // createLLMStream was awaited, its listeners are already gone (so the
    // panel would hang on "Streaming…" over the replacing tab) and llmCancel
    // cannot stop a request the backend has not registered yet.
    if (!task.isLive()) return;

    // Fire LLM request
    llmComplete(
      prompt,
      inlineCfg.model,
      requestId,
      systemPrompt,
      undefined,
      inlineCfg.provider,
      inlineCfg.baseUrl,
      store.privacyMode,
    ).catch(() => {
      // An early IPC failure emits no llm:error event, so without this the
      // panel would sit on "Streaming…" with no way out.
      logger.error("LLM request failed");
      completed = true;
      panel.setError("LLM request failed");
      panel.showActions();
    });

    // Wait for user decision
    const decision = await panel.waitForDecision();

    // Cancel if still streaming
    if (!completed) {
      llmCancel(requestId).catch(() => {});
    }

    // Apply if accepted — targetPos is only valid for the state the task
    // was registered against (§5c: check right before touching the editor).
    if (decision === "accept" && aiText.trim() && task.isLive()) {
      applyBlockAIResult(editor, targetPos, aiText);
    }
  } catch (err) {
    logger.error("Block AI diff aborted:", err);
  } finally {
    cleanupStream?.();
    task.finish();
    panel.remove();
  }
}

// ── DOM panel factory ───────────────────────────────────────────────

function createDiffPanel(
  originalText: string,
  anchorRect?: DOMRect,
): DiffPanel {
  // Remove any existing panel
  document.querySelector(".block-ai-diff-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "block-ai-diff-overlay";

  const panel = document.createElement("div");
  panel.className = "block-ai-diff-panel";

  // Header
  const header = document.createElement("div");
  header.className = "block-ai-diff-header";
  header.innerHTML =
    '<span class="block-ai-diff-title">AI Diff Preview</span>' +
    '<span class="block-ai-diff-streaming">Streaming…</span>';
  panel.appendChild(header);

  // Diff content area
  const content = document.createElement("div");
  content.className = "block-ai-diff-content";
  // Show original initially
  const origSpan = document.createElement("span");
  origSpan.className = "block-ai-diff-original";
  origSpan.textContent = originalText || "(empty)";
  content.appendChild(origSpan);
  panel.appendChild(content);

  // Error area (hidden by default)
  const errorEl = document.createElement("div");
  errorEl.className = "block-ai-diff-error";
  errorEl.style.display = "none";
  panel.appendChild(errorEl);

  // Actions (hidden until streaming completes)
  const actions = document.createElement("div");
  actions.className = "block-ai-diff-actions";
  actions.style.display = "none";

  const rejectBtn = document.createElement("button");
  rejectBtn.className = "block-ai-diff-btn block-ai-diff-btn-reject";
  rejectBtn.textContent = "Reject";
  const rejectKbd = document.createElement("kbd");
  rejectKbd.textContent = "Esc";
  rejectBtn.appendChild(rejectKbd);

  const acceptBtn = document.createElement("button");
  acceptBtn.className = "block-ai-diff-btn block-ai-diff-btn-accept";
  acceptBtn.textContent = "Accept";
  const acceptKbd = document.createElement("kbd");
  acceptKbd.textContent = "⌘↵";
  acceptBtn.appendChild(acceptKbd);

  actions.appendChild(rejectBtn);
  actions.appendChild(acceptBtn);
  panel.appendChild(actions);

  overlay.appendChild(panel);

  // Position near the anchor block
  if (anchorRect) {
    const top = anchorRect.bottom + 8;
    const left = Math.max(8, anchorRect.left);
    panel.style.position = "fixed";
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    // Keep within viewport
    requestAnimationFrame(() => {
      const panelRect = panel.getBoundingClientRect();
      if (panelRect.bottom > window.innerHeight - 8) {
        panel.style.top = `${anchorRect.top - panelRect.height - 8}px`;
      }
      if (panelRect.right > window.innerWidth - 8) {
        panel.style.left = `${window.innerWidth - panelRect.width - 8}px`;
      }
    });
  }

  document.body.appendChild(overlay);

  // ── Panel API ───────────────────────────────────────────────

  let aborted = false;
  let resolveDecision: ((d: "accept" | "reject") => void) | null = null;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

  function abort() {
    aborted = true;
    cleanup("reject");
    overlay.remove();
  }

  function updateDiff(original: string, ai: string) {
    content.innerHTML = "";
    if (!ai) {
      const s = document.createElement("span");
      s.className = "block-ai-diff-original";
      s.textContent = original || "(empty)";
      content.appendChild(s);
      return;
    }
    const diffs = diff(original, ai);
    for (const [op, text] of diffs) {
      const span = document.createElement("span");
      if (op === diff.DELETE) {
        span.className = "block-ai-diff-delete";
      } else if (op === diff.INSERT) {
        span.className = "block-ai-diff-insert";
      } else {
        span.className = "block-ai-diff-equal";
      }
      span.textContent = text;
      content.appendChild(span);
    }
  }

  function showActions() {
    const streaming = header.querySelector(".block-ai-diff-streaming");
    if (streaming) (streaming as HTMLElement).style.display = "none";
    actions.style.display = "flex";
  }

  function setError(msg: string) {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  }

  function cleanup(decision: "accept" | "reject") {
    if (keyHandler) {
      document.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
    if (resolveDecision) {
      resolveDecision(decision);
      resolveDecision = null;
    }
  }

  function remove() {
    overlay.remove();
    if (keyHandler) {
      document.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
  }

  function waitForDecision(): Promise<"accept" | "reject"> {
    // Aborted before anyone awaited: settle immediately so the caller's
    // await cannot hang forever on a panel that no longer exists.
    if (aborted) return Promise.resolve("reject");
    return new Promise((resolve) => {
      resolveDecision = resolve;

      acceptBtn.addEventListener("click", () => cleanup("accept"));
      rejectBtn.addEventListener("click", () => cleanup("reject"));
      overlay.addEventListener("mousedown", (e) => {
        if (e.target === overlay) cleanup("reject");
      });

      keyHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cleanup("reject");
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          cleanup("accept");
        }
      };
      document.addEventListener("keydown", keyHandler);
    });
  }

  return { abort, updateDiff, showActions, setError, waitForDecision, remove };
}

function stripCodeFences(text: string, nodeType: string): string {
  if (
    nodeType !== "codeBlock" &&
    nodeType !== "mermaidBlock" &&
    nodeType !== "svgBlock"
  )
    return text;
  const trimmed = text.trim();
  const match = trimmed.match(/^```[\w]*\n?([\s\S]*?)```$/);
  return match ? match[1].trimEnd() : trimmed;
}
