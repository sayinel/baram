// §312 정리 조작들이 공유하는 배관 — 조작마다 필요한 주변 값 한 덩어리와, 쓰고 나서
// 스토어를 사실과 맞추는 **유일한** 회계.
//
// 세 조작(날짜 부여·태그 토글·줄 삭제)이 전부 이 회계를 탄다. `task-triage.ts`에 두면
// 삭제(`task-delete.ts`)가 디스패처와 순환 import가 되므로 둘 아래로 내렸다.
import type { Translate } from "../../i18n/useTranslation";
import type { TaskEntry } from "../../ipc/types";
import type { TaskDeleteResult, TaskWriteResult } from "./apply-task-write";
import type { Editor } from "@tiptap/react";

import { refreshFileTasks } from "../../stores/tasks/task-store";
import { useUIStore } from "../../stores/ui/ui";
import { logger } from "../logger";
import { isDiskAuthoritative, isUnsavedWrite } from "./apply-task-write";
import { notifyUnsavedConflict } from "./task-write-feedback";

export interface TaskTriageContext {
  /** §305 라우터가 "활성 + dirty" 탭을 판정하고 라이브 문서를 읽는 데 쓴다. */
  editor: Editor | null;
  exclude: string[];
  /** 상대 날짜("오늘"·"내일"·`+3`)의 기준 — 패널이 보고 있는 그 날이다(I4). */
  now: Date;
  /**
   * §310 이 태스크의 **진실이 다시 맞춰진 뒤** 한 번. 스토어를 구독하지 않는 표면이
   * 자기 목록을 다시 읽는 자리다 — 쿼리 블록은 결과를 로컬 state로 들고 있어서, 이
   * 신호가 없으면 디스크에는 써졌는데 제어 체크박스만 원래대로 돌아간다.
   *
   * ‼️ "썼다"가 아니라 "맞췄다"이다. 쓰기가 **실패해도** 이 경로는 그 파일을 다시 읽어
   * 스토어를 고치므로(그것이 stale 자가 교정이다), 그때도 부른다 — 부르지 않으면 방금
   * 재스캔이 드러낸 사실을 이 표면만 모른 채 남는다. 거절(저장 안 된 충돌)에서는
   * 아무것도 다시 읽지 않으므로 부르지 않는다.
   */
  onReconciled?: () => void;
  t: Translate;
}

/**
 * 쓰고 나서 스토어를 사실과 맞춘다 — 정리 조작들이 공유하는 **유일한** 회계다.
 *
 * 세 갈래가 있고 셋 다 틀리기 쉽다:
 * - 저장 전 경로(문서·소스 버퍼)는 다시 읽으면 방금 만든 변경이 옛 디스크 내용으로
 *   되돌아간다. 스토어는 `reconcileUnsaved`가 제자리에서 맞춘다.
 * - ‼️ `stale`을 전부 "디스크가 진실원"으로 뭉뚱그리면 안 된다 — 소스·문서 경로에서
 *   거절된 것이면 그 파일의 진실은 여전히 저장되지 않은 버퍼다(`isDiskAuthoritative`).
 *   스토어는 만지지 않되 침묵하지도 않는다: 이 거절은 저장 전까지 영구적이라 알리지
 *   않으면 그 항목이 영원히 죽은 것처럼 보인다.
 * - stale이 아닌 실패(권한·디스크 가득 참·파일 삭제)를 조용히 삼키면 사용자에게는
 *   원인 모를 죽은 메뉴 항목으로만 보인다 — `onToggle`의 I5와 같은 실패 양식이다.
 *
 * `reconcileUnsaved`는 **저장 전 경로에서만** 불린다. 콜백인 이유: 편집은 그 한 줄을
 * `patchTask`로 갱신하면 되지만 삭제는 **조인 키 자체를 무효화**한다(지운 줄보다 아래에
 * 있던 모든 태스크의 `line`이 하나씩 올라온다). 회계의 세 갈래는 그래도 같으므로, 갈리는
 * 한 갈래만 호출자에게 넘긴다 — 여기서 갈라 두지 않으면 셋 중 둘이 두 벌이 된다.
 *
 * `write`도 콜백이다. 삭제는 결과 타입이 다르고(`TaskDeleteResult`) 진입점도 다르므로
 * (`applyTaskDelete`) `TaskChange` 하나로 묶을 수 없다.
 */
export async function writeAndReconcile<
  R extends TaskDeleteResult | TaskWriteResult,
>(
  task: TaskEntry,
  ctx: TaskTriageContext,
  write: () => Promise<R>,
  reconcileUnsaved: (
    result: Extract<R, { kind: "document" | "source" }>,
  ) => void,
): Promise<void> {
  let result: null | R = null;
  try {
    result = await write();
  } catch (err) {
    logger.warn("[tasks] triage write failed, re-scanning:", err);
    useUIStore.getState().showToast(ctx.t("tasks.triage.writeFailed"), "error");
  }

  if (isUnsavedWrite(result)) {
    reconcileUnsaved(result);
    ctx.onReconciled?.();
    return;
  }
  if (!isDiskAuthoritative(result)) {
    notifyUnsavedConflict(ctx.t);
    return;
  }
  await refreshFileTasks(task.path, ctx.exclude);
  ctx.onReconciled?.();
}
