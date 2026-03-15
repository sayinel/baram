// §11.2.3 Block AI Diff — Streaming diff preview panel for block-level AI actions
// Shows original vs AI text with inline diff, Accept/Reject controls.
// DOM-based (like showPrompt) so it works from both React and plain PM NodeViews.

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type { Editor } from "@tiptap/core";

import diff from "fast-diff";

import { llmCancel, llmComplete } from "../ipc/invoke";
import { useAIStore } from "../stores/ai/ai";
import { logger } from "./logger";
import { getConfigForTask } from "./model-selection";

// ── Apply result to the target block ────────────────────────────────

interface DiffPanel {
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
      editor.view.dispatch(editor.state.tr.insertText(cleaned, from, to));
      break;
    }
    case "image": {
      // Update alt text attribute
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(targetPos, undefined, {
          ...node.attrs,
          alt: cleaned,
        }),
      );
      break;
    }
    case "mathBlock": {
      // Formula stored in attribute
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(targetPos, undefined, {
          ...node.attrs,
          formula: cleaned,
        }),
      );
      break;
    }
    case "mermaidBlock": {
      // Code stored in attribute
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(targetPos, undefined, {
          ...node.attrs,
          code: cleaned,
        }),
      );
      break;
    }
    default: {
      // Fallback: replace text content
      const from = targetPos + 1;
      const to = targetPos + node.nodeSize - 1;
      if (from < to) {
        editor.view.dispatch(editor.state.tr.insertText(cleaned, from, to));
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

  if (!inlineCfg.apiKey && inlineCfg.provider !== "ollama") {
    logger.error("Block AI diff: no API key configured");
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

  const requestId = `block_ai_${Date.now()}`;
  let aiText = "";
  let completed = false;
  const unlistens: UnlistenFn[] = [];

  // Set up streaming listeners
  const tokenUn = await listen<{ requestId: string; token: string }>(
    "llm:token",
    (event) => {
      if (event.payload.requestId !== requestId) return;
      aiText += event.payload.token;
      panel.updateDiff(originalText, aiText);
    },
  );
  unlistens.push(tokenUn);

  const doneUn = await listen<{ requestId: string }>("llm:done", (event) => {
    if (event.payload.requestId !== requestId) return;
    completed = true;
    panel.updateDiff(originalText, aiText);
    panel.showActions();
  });
  unlistens.push(doneUn);

  const errorUn = await listen<{ error: string; requestId: string }>(
    "llm:error",
    (event) => {
      if (event.payload.requestId !== requestId) return;
      logger.error("Block AI diff error:", event.payload.error);
      completed = true;
      panel.setError(event.payload.error);
      panel.showActions();
    },
  );
  unlistens.push(errorUn);

  // Fire LLM request
  llmComplete(
    inlineCfg.apiKey,
    prompt,
    inlineCfg.model,
    requestId,
    systemPrompt,
    undefined,
    inlineCfg.provider,
    inlineCfg.baseUrl,
    store.privacyMode,
  ).catch((e) => logger.error(e));

  // Wait for user decision
  const decision = await panel.waitForDecision();

  // Cleanup listeners
  for (const un of unlistens) un();

  // Cancel if still streaming
  if (!completed) {
    llmCancel(requestId).catch(() => {});
  }

  // Apply if accepted
  if (decision === "accept" && aiText.trim()) {
    applyBlockAIResult(editor, targetPos, aiText);
  }

  panel.remove();
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

  let resolveDecision: ((d: "accept" | "reject") => void) | null = null;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

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

  return { updateDiff, showActions, setError, waitForDecision, remove };
}

function stripCodeFences(text: string, nodeType: string): string {
  if (nodeType !== "codeBlock" && nodeType !== "mermaidBlock") return text;
  const trimmed = text.trim();
  const match = trimmed.match(/^```[\w]*\n?([\s\S]*?)```$/);
  return match ? match[1].trimEnd() : trimmed;
}
