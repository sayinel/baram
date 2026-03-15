// §6.2 Shared AI command utilities — used by slash menu, FloatingToolbar, CommandPalette
import type { Editor } from "@tiptap/core";

import { llmComplete } from "../ipc/invoke";
import { useAIStore } from "../stores/ai/ai";
import { createLLMStream } from "./llm-stream";
import { logger } from "./logger";
import { getConfigForTask } from "./model-selection";
import { getFilePrivacy, isLLMAllowed } from "./privacy-check";

export interface AICommandOptions {
  // When true, insert response on a new line after the block containing the selection end
  afterSelection?: boolean;
  // Explicit document position to insert after (overrides afterSelection)
  insertAfterPos?: number;
}

// Custom prompt dialog — replaces window.prompt() which doesn't work in Tauri WKWebView
export interface PromptOptions {
  /** Preset quick-pick choices shown as buttons above the input */
  presets?: string[];
}

// Stream LLM response tokens into editor at cursor
export async function executeAICommand(
  editor: Editor,
  prompt: string,
  systemPrompt: string,
  options?: AICommandOptions,
): Promise<void> {
  const store = useAIStore.getState();

  const inlineCfg = getConfigForTask("inline-edit");

  if (!inlineCfg.apiKey && inlineCfg.provider !== "ollama") {
    logger.error("AI command: no API key configured");
    return;
  }

  const filePrivacy = getFilePrivacy(editor);
  if (!isLLMAllowed(store.privacyMode, inlineCfg.provider, filePrivacy)) {
    logger.error("AI command: blocked by privacy settings");
    return;
  }

  const requestId = `ai_slash_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  let currentPos: number;

  if (options?.insertAfterPos != null) {
    // Insert a new paragraph at the explicit position (after a specific block)
    editor
      .chain()
      .focus()
      .insertContentAt(options.insertAfterPos, { type: "paragraph" })
      .run();
    currentPos = options.insertAfterPos + 1; // inside the new paragraph
  } else if (options?.afterSelection) {
    // Insert a new paragraph after the block that contains the selection end
    const { to } = editor.state.selection;
    const $to = editor.state.doc.resolve(to);
    const afterBlock = $to.after(1); // position after the top-level block
    editor
      .chain()
      .focus()
      .insertContentAt(afterBlock, { type: "paragraph" })
      .run();
    currentPos = afterBlock + 1; // inside the new paragraph
  } else {
    // Original behavior: insert at cursor position
    const insertPos = editor.state.selection.to;
    editor.chain().focus().insertContentAt(insertPos, "\n").run();
    currentPos = insertPos;
  }

  const cleanupStream = await createLLMStream(requestId, {
    onToken: (token) => {
      editor.chain().focus().insertContentAt(currentPos, token).run();
      currentPos += token.length;
    },
    onError: (error) => logger.error("AI command error:", error),
  });

  // Fire LLM request; cleanup listeners always to prevent leaks
  try {
    await llmComplete(
      inlineCfg.apiKey,
      prompt,
      inlineCfg.model,
      requestId,
      systemPrompt,
      undefined,
      inlineCfg.provider,
      inlineCfg.baseUrl,
      store.privacyMode,
    );
  } catch {
    logger.error("LLM request failed");
  } finally {
    cleanupStream();
  }
}

// Get only the selected text (empty string if no selection)
export function getSelectedText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  if (from !== to) {
    return editor.state.doc.textBetween(from, to);
  }
  return "";
}

// Get selected text or fall back to current paragraph text
export function getSelectionOrParagraph(editor: Editor): string {
  const { from, to } = editor.state.selection;
  if (from !== to) {
    return editor.state.doc.textBetween(from, to);
  }
  // Fall back to current paragraph
  const $pos = editor.state.selection.$from;
  const node = $pos.parent;
  return node.textContent || "";
}

export function showPrompt(
  message: string,
  defaultValue = "",
  options?: PromptOptions,
): Promise<null | string> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ai-prompt-overlay";

    const dialog = document.createElement("div");
    dialog.className = "ai-prompt-dialog";

    const label = document.createElement("p");
    label.className = "ai-prompt-label";
    label.textContent = message;

    dialog.appendChild(label);

    // Preset quick-pick buttons
    if (options?.presets?.length) {
      const presetRow = document.createElement("div");
      presetRow.className = "ai-prompt-presets";
      for (const preset of options.presets) {
        const btn = document.createElement("button");
        btn.className = "ai-prompt-preset-btn";
        btn.textContent = preset;
        btn.addEventListener("click", () => cleanup(preset));
        presetRow.appendChild(btn);
      }
      dialog.appendChild(presetRow);
    }

    const input = document.createElement("input");
    input.className = "ai-prompt-input";
    input.type = "text";
    input.value = defaultValue;
    input.placeholder = options?.presets?.length ? "Or type another..." : "";

    const btnRow = document.createElement("div");
    btnRow.className = "ai-prompt-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "ai-prompt-btn ai-prompt-btn-cancel";
    cancelBtn.textContent = "Cancel";

    const okBtn = document.createElement("button");
    okBtn.className = "ai-prompt-btn ai-prompt-btn-ok";
    okBtn.textContent = "OK";

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    dialog.appendChild(input);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const cleanup = (value: null | string) => {
      overlay.remove();
      resolve(value);
    };

    okBtn.addEventListener("click", () => cleanup(input.value || null));
    cancelBtn.addEventListener("click", () => cleanup(null));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) cleanup(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        cleanup(input.value || null);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(null);
      }
    });

    requestAnimationFrame(() => input.focus());
  });
}
