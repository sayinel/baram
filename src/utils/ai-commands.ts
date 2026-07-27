import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

// §6.2 Shared AI command utilities — used by slash menu, FloatingToolbar, CommandPalette
import { chainWithVimExternalEdit } from "../extensions/plugins/vim/vim-keys";
import { llmCancel, llmComplete } from "../ipc/invoke";
import { useAIStore } from "../stores/ai/ai";
import { registerEditorMutationTask } from "./editor/mutation-tasks";
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

  if (!inlineCfg.configured && inlineCfg.provider !== "ollama") {
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
    chainWithVimExternalEdit(editor)
      .focus()
      .insertContentAt(options.insertAfterPos, { type: "paragraph" })
      .run();
    currentPos = options.insertAfterPos + 1; // inside the new paragraph
  } else if (options?.afterSelection) {
    // Insert a new paragraph after the block that contains the selection end
    const { to } = editor.state.selection;
    const $to = editor.state.doc.resolve(to);
    const afterBlock = $to.after(1); // position after the top-level block
    chainWithVimExternalEdit(editor)
      .focus()
      .insertContentAt(afterBlock, { type: "paragraph" })
      .run();
    currentPos = afterBlock + 1; // inside the new paragraph
  } else {
    // Original behavior: insert at cursor position
    const insertPos = editor.state.selection.to;
    chainWithVimExternalEdit(editor)
      .focus()
      .insertContentAt(insertPos, "\n")
      .run();
    currentPos = insertPos;
  }

  // §298 §12-9b (design §5c): the token stream is a background mutation —
  // if the task dies (state install / vim mode exit), late tokens must not
  // touch the editor, and the listeners are the cancelable source.
  // PRE-EXISTING DEFECT (surfaced by review R10, present since before §298):
  // currentPos is a raw offset that only advanced by its own token lengths.
  // Any edit landing before it while the stream runs — the user typing above,
  // a second AI command — shifts the document without shifting this number,
  // so the next token lands inside an unrelated block. Mutation generation
  // cannot catch this: it only advances on a whole-state install, not on
  // ordinary edits. Map the position through every transaction instead.
  // This also covers our OWN inserts, so the manual `+= token.length` goes
  // away — a JS string length is not a ProseMirror offset anyway.
  const trackPos = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.docChanged) {
      currentPos = transaction.mapping.map(currentPos, 1);
    }
  };
  editor.on("transaction", trackPos);
  let detached = false;
  const detachTrackPos = () => {
    if (detached) return;
    detached = true;
    editor.off("transaction", trackPos);
  };

  const task = registerEditorMutationTask(editor.view);
  // Detaching only in the finally is not enough: if a state install happens
  // while createLLMStream or llmComplete is pending and that promise never
  // settles, the finally never runs and this handler keeps mapping a stale
  // position across every transaction of the NEW document — on the shared
  // editor, forever. Hang it on the task so invalidation always detaches.
  task.addCleanup(detachTrackPos);
  // The whole flow lives in the try so a createLLMStream rejection cannot
  // strand the task (its await used to sit outside any handler).
  let cleanupStream: (() => void) | undefined;
  try {
    cleanupStream = await createLLMStream(requestId, {
      onToken: (token) => {
        if (!task.isLive()) return;
        editor.chain().focus().insertContentAt(currentPos, token).run();
        // trackPos advances currentPos from the resulting transaction.
      },
      onError: (error) => logger.error("AI command error:", error),
    });
    const stopStream = cleanupStream;
    task.addCleanup(() => {
      llmCancel(requestId).catch(() => {}); // stop the Rust-side stream
      stopStream(); // idempotent (llm-stream drains its list)
    });

    // Setup was awaited: if the document was replaced meanwhile the cleanup
    // above already removed the listeners, so firing the request would bill
    // an answer nothing can receive.
    if (!task.isLive()) return;

    await llmComplete(
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
    detachTrackPos();
    cleanupStream?.();
    task.finish();
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
