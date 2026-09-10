// §11.8 Smart Template Dialog wrapper — owns generation state and streams the
// LLM response into the active editor
import { lazy, useCallback } from "react";

import type { Editor } from "@tiptap/core";

import { useShallow } from "zustand/shallow";

import { llmCancel, llmComplete } from "../../ipc/invoke";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { useAIStore } from "../../stores/ai/ai";
import { useUIStore } from "../../stores/ui/ui";
import { registerEditorMutationTask } from "../../utils/editor/mutation-tasks";
import { createLLMStream } from "../../utils/llm-stream";
import { logger } from "../../utils/logger";
import { getConfigForTask } from "../../utils/model-selection";
import { getFilePrivacy, isLLMAllowed } from "../../utils/privacy-check";
import { buildTemplatePrompt } from "../../utils/smart-templates";

const SmartTemplateDialog = lazy(() =>
  import("./SmartTemplateDialog").then((m) => ({
    default: m.SmartTemplateDialog,
  })),
);

export function SmartTemplateDialogWrapper({
  editor,
}: {
  editor: Editor | null;
}) {
  const { smartTemplateDialogOpen, toggleSmartTemplateDialog } = useUIStore(
    useShallow((s) => ({
      smartTemplateDialogOpen: s.smartTemplateDialogOpen,
      toggleSmartTemplateDialog: s.toggleSmartTemplateDialog,
    })),
  );
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
      // ‼️ §339 — 이 호출부는 `isLLMAllowed` 를 전혀 부르지 않는다. 지금 유일한 진입점이
      // 슬래시 AI 그룹(게이트됨)이라 도달 불가지만, 그래서 **I-4 의 tsc 메커니즘이
      // 구조적으로 못 덮는 자리**다 — 팔레트나 단축키 진입점이 하나 생기면 C-1(✨ 6곳이
      // 무게이트였던 그것)이 조용히 다시 열린다. "지금 도달 불가"를 근거로 열어 두었다가
      // 틀린 전례가 이 브랜치에 있다(`SkillOptimizeSection` — 부수효과 import 라
      // JSX grep 이 못 봤다). privacy 는 Rust 가 막지만 `aiEnabled` 는 프런트 전용이다.
      if (
        !isLLMAllowed(
          store.aiEnabled,
          store.privacyMode,
          inlineCfg.provider,
          getFilePrivacy(editor),
        )
      ) {
        logger.error("SmartTemplate: blocked by AI/privacy settings");
        return;
      }
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
