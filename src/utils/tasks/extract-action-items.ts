// §314 선택 영역(또는 문서 전체)에서 액션 아이템을 뽑는다.
//
// ‼️ **뽑은 것을 문서에 바로 쓰지 않는다.** §18.20의 위험 8이 이것을 못 박는다: 확인 없이
// 태스크를 쓰면 사용자가 쓰지 않은 내용이 문서에 남는다. 게다가 태스크는 문서 안에만
// 머무르지 않는다 — 그 줄은 곧바로 아젠다·쿼리 블록·태그 인덱스에 나타난다. 그래서 결과는
// `pendingInsertTasks`로 나가고, AI diff 미리보기를 지나 사용자가 받아들여야 문서가 된다.
// 이 경로를 우회하는 다른 길을 만들지 않는다.
//
// 스트리밍하지 않고 **다 받아서 한 번에** 다듬는 것도 요건이다. `normalizeActionItems`는
// 줄 단위로 버리고 고치므로 반쪽짜리 줄에는 쓸 수 없고, 토막이 미리보기에 흘러 들어가면
// 사용자는 다듬기 전의 머리말까지 보게 된다.

import type { Locale } from "../../i18n";
import type { Editor } from "@tiptap/core";

import { t } from "../../i18n";
import { llmComplete } from "../../ipc/invoke";
import { useAIStore } from "../../stores/ai/ai";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { registerEditorMutationTask } from "../editor/mutation-tasks";
import { createLLMStream } from "../llm-stream";
import { logger } from "../logger";
import { getConfigForTask } from "../model-selection";
import { getFilePrivacy, isLLMAllowed } from "../privacy-check";
import {
  ACTION_ITEM_SYSTEM_PROMPT,
  normalizeActionItems,
} from "./action-items";

/** 뽑을 대상 — 선택이 있으면 그것, 없으면 문서 전체(회의록 한 편이 곧 문맥이다). */
export function extractionSource(editor: Editor): string {
  const { from, to } = editor.state.selection;
  return from === to
    ? editor.state.doc.textContent
    : editor.state.doc.textBetween(from, to, "\n");
}

/**
 * 액션 아이템을 뽑아 **미리보기 대기열에** 넣는다. 문서는 여기서 바뀌지 않는다.
 *
 * 뽑을 것이 없거나 모델이 형식을 통째로 어겨 남는 줄이 없으면 알리고 끝낸다 — 빈
 * 미리보기를 띄우면 사용자는 받아들일 것이 없는 화면과 마주한다.
 */
export async function extractActionItems(editor: Editor): Promise<void> {
  const locale = useSettingsStore.getState().locale as Locale;
  const toast = useUIStore.getState().showToast;

  const source = extractionSource(editor).trim();
  if (source === "") {
    toast(t("tasks.extract.empty", locale), "info");
    return;
  }

  const store = useAIStore.getState();
  const cfg = getConfigForTask("inline-edit");
  if (!cfg.configured && cfg.provider !== "ollama") {
    toast(t("tasks.extract.noModel", locale), "error");
    return;
  }
  if (!isLLMAllowed(store.privacyMode, cfg.provider, getFilePrivacy(editor))) {
    toast(t("tasks.extract.blocked", locale), "error");
    return;
  }

  const requestId = `extract_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  // §12-9b 문서가 바뀌면(탭 전환·외부 리로드) 늦게 온 답은 아무것도 하지 않는다.
  const task = registerEditorMutationTask(editor.view);
  let buffer = "";

  toast(t("tasks.extract.running", locale), "info");

  let cleanup: (() => void) | undefined;
  try {
    cleanup = await createLLMStream(requestId, {
      onError: (error) => logger.error("action item extraction:", error),
      onToken: (token) => {
        buffer += token;
      },
    });
    if (!task.isLive()) return;

    await llmComplete(
      source,
      cfg.model,
      requestId,
      ACTION_ITEM_SYSTEM_PROMPT,
      1024,
      cfg.provider,
      cfg.baseUrl,
      store.privacyMode,
    );
    if (!task.isLive()) return;

    const tasks = normalizeActionItems(buffer, new Date());
    if (tasks === "") {
      toast(t("tasks.extract.none", locale), "info");
      return;
    }
    useUIStore.getState().setPendingInsertTasks(tasks);
  } catch {
    logger.error("action item extraction failed");
    if (task.isLive()) toast(t("tasks.extract.failed", locale), "error");
  } finally {
    // CLAUDE.md 규약 — `createLLMStream`의 반환값은 반드시 finally에서 부른다.
    cleanup?.();
    task.finish();
  }
}
