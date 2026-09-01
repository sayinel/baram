// §11.8 Smart Template Dialog wrapper — owns generation state and streams the
// LLM response into the active editor
import { lazy, useCallback } from "react";

import type { useEditor } from "@tiptap/react";

import { llmCancel, llmComplete } from "../../ipc/invoke";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { useAIStore } from "../../stores/ai/ai";
import { useUIStore } from "../../stores/ui/ui";
import { registerEditorMutationTask } from "../../utils/editor/mutation-tasks";
import { createLLMStream } from "../../utils/llm-stream";
import { logger } from "../../utils/logger";
import { getConfigForTask } from "../../utils/model-selection";
import { buildTemplatePrompt } from "../../utils/smart-templates";

const SmartTemplateDialog = lazy(() =>
  import("./SmartTemplateDialog").then((m) => ({
    default: m.SmartTemplateDialog,
  })),
);

export function SmartTemplateDialogWrapper({
  editor,
}: {
  editor: null | ReturnType<typeof useEditor>;
}) {
  const { smartTemplateDialogOpen, toggleSmartTemplateDialog } = useUIStore();
  const handleGenerate = useCallback(
    (templateId: string) => {
      if (!editor) return;
      toggleSmartTemplateDialog();
      const isCustom = templateId.startsWith("custom:");
      const prompt = isCustom
        ? templateId.slice("custom:".length)
        : buildTemplatePrompt(templateId);
      const systemPrompt = isCustom
        ? "Generate a well-structured markdown document based on the user's description. Include headings, sections, and placeholder content."
        : "Generate a complete markdown document based on the template structure. Fill each section with relevant placeholder content.";

      // Accumulate all tokens, then insert parsed markdown (not raw text)
      const inlineCfg = getConfigForTask("inline-edit");
      if (!inlineCfg.configured && inlineCfg.provider !== "ollama") {
        logger.error("SmartTemplate: no API key configured");
        return;
      }
      const store = useAIStore.getState();
      const requestId = `ai_template_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      let accumulated = "";

      void (async () => {
        // §298 §12-9b (design §5c): the insert lands when the stream ends —
        // a dead task (state install / vim mode exit) must not dispatch.
        const task = registerEditorMutationTask(editor.view);
        const cleanupFn = await createLLMStream(requestId, {
          onToken: (token) => {
            accumulated += token;
          },
          onDone: () => {
            if (accumulated.trim() && task.isLive()) {
              const doc = markdownToProsemirror(accumulated, editor.schema);
              const { from } = editor.state.selection;
              editor.view.dispatch(
                editor.state.tr.insert(from, doc.content).scrollIntoView(),
              );
              editor.view.focus();
            }
          },
          onError: (error) => {
            logger.error("SmartTemplate error:", error);
          },
        });
        task.addCleanup(() => {
          llmCancel(requestId).catch(() => {});
          cleanupFn();
        });
        // A task that died while createLLMStream was awaited has already had
        // its listeners removed; firing the request anyway would bill an
        // answer nobody can receive.
        if (!task.isLive()) {
          task.finish();
          return;
        }
        try {
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
        } catch (e) {
          logger.error(e);
        } finally {
          cleanupFn();
          task.finish();
        }
      })();
    },
    [editor, toggleSmartTemplateDialog],
  );
  return (
    <SmartTemplateDialog
      isOpen={smartTemplateDialogOpen}
      onClose={toggleSmartTemplateDialog}
      onGenerate={handleGenerate}
    />
  );
}
