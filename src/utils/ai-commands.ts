import type { Editor, EditorEvents } from "@tiptap/core";

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

  // Where the response goes: a new paragraph after an explicit block, a new
  // paragraph after the block holding the selection end, or (the original
  // behavior) a newline at the cursor with the tokens landing before it.
  // Decided before anything is dispatched so the anchor below can be tracked
  // through the setup edit itself.
  const insertParagraph =
    options?.insertAfterPos != null || options?.afterSelection === true;
  const setupPos =
    options?.insertAfterPos != null
      ? options.insertAfterPos
      : options?.afterSelection
        ? editor.state.doc.resolve(editor.state.selection.to).after(1)
        : editor.state.selection.to;

  // §298 §12-9b (design §5c): the token stream is a background mutation —
  // if the task dies (state install / vim mode exit), late tokens must not
  // touch the editor, and the listeners are the cancelable source.
  const task = registerEditorMutationTask(editor.view);

  // The insertion anchor. It used to be a raw offset that advanced only by
  // its own token lengths (review R10): any edit landing above it while the
  // stream ran — the user typing, a second command — shifted the document
  // without shifting the number, and the next token landed in an unrelated
  // block. Mutation generation cannot catch that (it only advances on a
  // whole-state install), so the anchor is MAPPED through every transaction
  // the editor applies: the root one AND every one a plugin appended to it
  // (issue 374). syntax-reveal's cursor-out collapse turns `**bold**` back
  // into `bold` inside an appended transaction, four positions shorter, and
  // it hangs off whatever moved the cursor out — the user's click, or our own
  // paragraph insert below. Tracking starts BEFORE that insert for the same
  // reason: an anchor computed from pre-insert positions is stale as soon as
  // the insert's appended collapse lands.
  //
  // Two phases. During setup the anchor is the position the paragraph (or
  // newline) goes in AT, mapped with assoc -1 so our own insert lands after
  // it; then it steps inside the paragraph and switches to assoc 1 so each
  // token appends after the previous one. This also covers our own token
  // inserts, so no manual `+= token.length` — a JS string length is not a
  // ProseMirror offset anyway.
  let currentPos = setupPos;
  let assoc: -1 | 1 = -1;
  const trackPos = ({
    transaction,
    appendedTransactions,
  }: EditorEvents["transaction"]) => {
    if (transaction.docChanged) {
      currentPos = transaction.mapping.map(currentPos, assoc);
    }
    for (const tr of appendedTransactions) {
      if (tr.docChanged) currentPos = tr.mapping.map(currentPos, assoc);
    }
  };
  editor.on("transaction", trackPos);
  let detached = false;
  const detachTrackPos = () => {
    if (detached) return;
    detached = true;
    editor.off("transaction", trackPos);
  };
  // Detaching only in the finally is not enough: if a state install happens
  // while createLLMStream or llmComplete is pending and that promise never
  // settles, the finally never runs and this handler keeps mapping a stale
  // position across every transaction of the NEW document — on the shared
  // editor, forever. Hang it on the task so invalidation always detaches.
  task.addCleanup(detachTrackPos);

  // The whole flow lives in the try so that neither a createLLMStream
  // rejection (its await used to sit outside any handler) nor a setup insert
  // at a position the document no longer has (a block action's target kept
  // across its prompt while the user edited) can strand the task or leave the
  // tracker attached.
  let cleanupStream: (() => void) | undefined;
  try {
    chainWithVimExternalEdit(editor)
      .focus()
      .insertContentAt(setupPos, insertParagraph ? { type: "paragraph" } : "\n")
      .run();
    if (insertParagraph) currentPos += 1; // inside the new paragraph
    assoc = 1;

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
  } catch (error) {
    logger.error("AI command failed:", error);
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
