// §312 아젠다 행 정리 조작 — 이번 슬라이스는 날짜 부여 하나다.
//
// `set_task_field`의 배관은 §309 일괄 조정이 이미 검증했다(디스크·문서 경로 바이트
// 단위 동등성 테스트가 task_cmd.rs:130-186에 붙어 있다). 여기서 새로 하는 것은
// **임의의 행 · 임의의 날짜**로 그 경로를 여는 것뿐이다.
//
// Task 3(#someday 토글)·Task 4(줄 삭제)가 이 파일에 형제 함수를 더한다. 그래서
// 조작마다 필요한 주변 값(라우팅용 editor, 재스캔용 rootPath/exclude, 다이얼로그용
// t)을 `TaskTriageContext` 한 덩어리로 받는다 — 형제가 생길 때마다 인자 목록을
// 다시 짜지 않게 하려는 것이고, `runTaskTriageAction`이 그 한 덩어리를 그대로
// 넘겨주는 유일한 디스패처가 된다.

import type { Translate } from "../../i18n/useTranslation";
import type { TaskEntry } from "../../ipc/types";
import type { TaskWriteResult } from "./apply-task-write";
import type { Editor } from "@tiptap/react";

import { refreshFileTasks, useTaskStore } from "../../stores/tasks/task-store";
import { useUIStore } from "../../stores/ui/ui";
import { showFieldDialog } from "../field-dialog";
import { logger } from "../logger";
import {
  applyTaskWrite,
  isDiskAuthoritative,
  isUnsavedWrite,
} from "./apply-task-write";
import { resolveDateInput } from "./task-date-input";
import { notifyUnsavedConflict } from "./task-write-feedback";

/** `FIELD_EMOJI`(write.rs:5-12)의 날짜 필드 중 사용자가 손으로 정하는 셋. */
export type TaskDateField = "due" | "scheduled" | "start";

export interface TaskMenuItem {
  /** 액션 식별자 — 아래 `runTaskTriageAction`이 이 문자열로 갈린다. */
  id: string;
  label: string;
}

export interface TaskTriageContext {
  /** §305 라우터가 "활성 + dirty" 탭을 판정하고 라이브 문서를 읽는 데 쓴다. */
  editor: Editor | null;
  exclude: string[];
  /** 상대 날짜("오늘"·"내일"·`+3`)의 기준 — 패널이 보고 있는 그 날이다(I4). */
  now: Date;
  rootPath: null | string;
  t: Translate;
}

/**
 * §312 날짜 부여.
 *
 * ‼️ `task.due`로 "이미 날짜가 있는가"를 판정하지 말 것. 파서는 날짜 이모지의
 * **첫** 등장을 읽는데 writer는 **마지막 유효한** 것을 쓰므로, 본문에 장식용 📅가
 * 있으면 거짓 음성이 나온다(dev/backlog.md P2). 호출부가 항목을 회색으로 만들지
 * 않는 이유이고, 여기서도 현재 값을 보지 않고 그냥 쓴다.
 */
export async function assignTaskDate(
  task: TaskEntry,
  field: TaskDateField,
  iso: string,
  ctx: TaskTriageContext,
): Promise<void> {
  let result: null | TaskWriteResult = null;
  try {
    result = await applyTaskWrite(
      task,
      { field, kind: "field", value: iso },
      ctx.editor,
    );
  } catch (err) {
    // stale이 아닌 실패(권한·디스크 가득 참·파일 삭제)를 조용히 삼키면 사용자에게는
    // 원인 모를 죽은 메뉴 항목으로만 보인다 — `onToggle`의 I5와 같은 실패 양식이다.
    logger.warn("[tasks] date assignment failed, re-scanning:", err);
    useUIStore.getState().showToast(ctx.t("tasks.triage.writeFailed"), "error");
  }

  if (isUnsavedWrite(result)) {
    // 아직 디스크에 없다(열린 문서 또는 소스 버퍼) — 다시 읽으면 방금 만든 변경이
    // 옛 내용으로 되돌아간다. 실제로 쓰인 줄과 방금 민 필드만 제자리에서 갱신한다.
    const patch: Partial<TaskEntry> = { raw: result.raw };
    patch[field] = iso;
    useTaskStore.getState().patchTask(task.path, task.line, patch);
    return;
  }
  // ‼️ `stale`을 전부 "디스크가 진실원"으로 뭉뚱그리면 안 된다 — 소스·문서 경로에서
  // 거절된 것이면 그 파일의 진실은 여전히 저장되지 않은 버퍼다(isDiskAuthoritative).
  if (!isDiskAuthoritative(result)) {
    // 스토어는 만지지 않되 침묵하지도 않는다 — 이 거절은 저장 전까지 영구적이라
    // 알리지 않으면 그 항목이 영원히 죽은 것처럼 보인다.
    notifyUnsavedConflict(ctx.t);
    return;
  }
  await refreshFileTasks(task.path, ctx.rootPath, ctx.exclude);
}

/**
 * 정리 메뉴가 그릴 항목 — 이번 슬라이스는 셋 다 `due`다. `scheduled`/`start` 하위
 * 메뉴는 §312가 요구하지 않으므로 넣지 않는다(YAGNI). Task 3·4가 여기에 줄을
 * 더하고 아래 switch에 짝이 되는 case를 더한다.
 *
 * ‼️ `task.due`를 보고 날짜 항목을 회색으로 만들지 말 것. 파서는 날짜 이모지의 **첫**
 * 등장을 읽는데 writer는 **마지막 유효한** 것을 쓰므로, 본문에 장식용 📅가 있는
 * 행에서는 `TaskEntry.due`가 거짓 음성이 된다(dev/backlog.md P2) — 그 값으로
 * 잠그면 멀쩡한 행에서 메뉴가 죽는다. 그래서 지금 항목들은 태스크를 보지 않는다.
 *
 * 그래도 `task`를 받는다: Task 3의 `#someday`는 **토글**이라 라벨이
 * `task.tags.includes("someday")`에 달려 있다. 그때 시그니처를 바꾸면 호출부의 memo와
 * 이 주석까지 함께 되돌려야 하므로, 항목을 태스크에서 만드는 계약을 지금 세워 둔다.
 * 호출부는 메뉴가 열려 있는 동안에만(`menu.task`로) 이 함수를 부른다.
 */
export function buildTriageItems(
  t: Translate,
  _task: TaskEntry,
): TaskMenuItem[] {
  return [
    { id: "dueToday", label: t("tasks.triage.dueToday") },
    { id: "dueTomorrow", label: t("tasks.triage.dueTomorrow") },
    { id: "duePick", label: t("tasks.triage.duePick") },
  ];
}

/**
 * 메뉴 항목 id → 조작. `FileTree`의 `handleContextMenuAction`과 같은 모양이다 —
 * 메뉴는 id만 올려 보내고 무엇을 할지는 전부 여기서 갈린다.
 *
 * Task 3·4는 이 switch에 case를 더한다.
 */
export async function runTaskTriageAction(
  action: string,
  task: TaskEntry,
  ctx: TaskTriageContext,
): Promise<void> {
  switch (action) {
    case "duePick":
      return pickDueDate(task, ctx);
    case "dueToday":
      return assignTaskDate(task, "due", relativeIso("t", ctx.now), ctx);
    case "dueTomorrow":
      return assignTaskDate(task, "due", relativeIso("m", ctx.now), ctx);
    default:
      // 메뉴에 항목을 더하면서 case를 잊는 것이 이 파일에서 가장 있을 법한 실수다.
      logger.warn("[tasks] unknown triage action:", action);
  }
}

/**
 * 자유 입력으로 기한을 정한다. 파싱은 §303 입력 규칙의 `resolveDateInput`을 그대로
 * 쓴다 — ISO·`t`·`m`·`+N`·`M/D`를 이미 알고 있으므로 여기서 날짜 산술을 두 벌로
 * 만들 이유가 없다.
 */
async function pickDueDate(
  task: TaskEntry,
  ctx: TaskTriageContext,
): Promise<void> {
  const values = await showFieldDialog({
    fields: [
      {
        key: "date",
        label: ctx.t("tasks.triage.pickLabel"),
        placeholder: "2026-08-30",
      },
    ],
    submitLabel: ctx.t("tasks.triage.pickSubmit"),
    title: ctx.t("tasks.triage.pickTitle"),
  });
  if (values === null) return;

  const raw = (values.date ?? "").trim();
  // 빈 채로 확인한 것은 취소와 같은 뜻이다 — 여기에 오류를 띄우면 실수 하나에
  // 경고가 붙는다.
  if (raw === "") return;

  const iso = resolveDateInput(raw, ctx.now);
  if (iso === null) {
    // 조용히 아무 일도 하지 않으면 사용자에게는 "확인이 먹지 않았다"로 보인다.
    useUIStore
      .getState()
      .showToast(ctx.t("tasks.triage.badDate", { value: raw }), "error");
    return;
  }
  await assignTaskDate(task, "due", iso, ctx);
}

/**
 * `t`(오늘)·`m`(내일)을 ISO로 푼다. `resolveDateInput`은 이 두 토큰을 절대 거절하지
 * 않지만 반환 타입이 `null | string`이라, 그 계약을 여기서 한 번만 좁힌다.
 */
function relativeIso(token: "m" | "t", now: Date): string {
  const iso = resolveDateInput(token, now);
  if (iso === null) throw new Error(`resolveDateInput rejected "${token}"`);
  return iso;
}
