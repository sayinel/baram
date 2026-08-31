// §312 아젠다 행 정리 조작 — 날짜 부여, `#someday` 토글, 줄 삭제의 디스패처.
//
// `set_task_field`의 배관은 §309 일괄 조정이 이미 검증했다(디스크·문서 경로 바이트
// 단위 동등성 테스트가 task_cmd.rs에 붙어 있다). 태그 쓰기는 그 배관을 재사용할 수
// 없어 백엔드가 따로 있다(`set_task_tag`/`preview_task_tag_line`) — §303 순서상 태그는
// 이모지 필드 **앞**인데 `append_field`는 항상 줄 끝에 붙이기 때문이다. 삭제는 그 배관을
// 아예 타지 않는다(`task-delete.ts`) — 줄을 지우는 데는 줄 문법 지식이 필요 없다.
//
// 조작마다 필요한 주변 값(라우팅용 editor, 재스캔용 rootPath/exclude, 다이얼로그용 t)은
// `TaskTriageContext` 한 덩어리로 받는다 — `runTaskTriageAction`이 그 한 덩어리를 그대로
// 넘겨주는 유일한 디스패처다. 그 타입과 쓰기 후 회계(`writeAndReconcile`)는 삭제도 함께
// 쓰므로 `task-triage-write.ts`에 산다(여기 두면 삭제와 순환 import가 된다).

import type { Translate } from "../../i18n/useTranslation";
import type { TaskEntry, TaskState } from "../../ipc/types";
import type { TaskTriageContext } from "./task-triage-write";

import { useTaskStore } from "../../stores/tasks/task-store";
import { useUIStore } from "../../stores/ui/ui";
import { showFieldDialog } from "../field-dialog";
import { logger } from "../logger";
import { applyTaskWrite } from "./apply-task-write";
import { isSameLine } from "./line-splice";
import { resolveDateInput } from "./task-date-input";
import { confirmAndDeleteTaskLine } from "./task-delete";
import { scanTaskFields } from "./task-field-scan";
import { SOMEDAY_TAG } from "./task-filters";
import { TASK_ROW_KEY_HINT } from "./task-row-keys";
import { nextTaskState } from "./task-state";
import { lineHasTag } from "./task-tag-token";
import { timerForState } from "./task-timer";
import { writeAndReconcile } from "./task-triage-write";

// 정리 조작 전부가 이 컨텍스트를 받으므로 호출부(`use-task-triage.ts`·테스트)는 계속
// 여기서 타입을 가져온다 — 배관을 아래로 내린 것이 호출부에 보일 이유가 없다.
export type { TaskTriageContext } from "./task-triage-write";

/** `FIELD_EMOJI`(write.rs:5-12)의 날짜 필드 중 사용자가 손으로 정하는 셋. */
export type TaskDateField = "due" | "scheduled" | "start";

/**
 * §312 `#someday` 토글이 이 행에서 할 수 있는 일. `locked`가 세 번째로 필요한 이유는
 * `somedayVerdict`에 있다 — "붙일 수 있다"와 "뗄 수 있다"만으로는 **뗄 수 없는데 붙어
 * 있는** 행을 표현할 수 없고, 그 행에서 라벨이 거짓말을 한다.
 */
type SomedayVerdict = "add" | "locked" | "remove";

/** 판정 → 라벨 키. 라벨과 디스패처가 **같은 표**를 봐야 둘이 갈라지지 않는다. */
const SOMEDAY_LABEL: Record<SomedayVerdict, string> = {
  add: "tasks.triage.someday",
  locked: "tasks.triage.somedayLocked",
  remove: "tasks.triage.somedayOff",
};

export interface TaskMenuItem {
  /**
   * 파괴적 항목 — 위쪽 구분선과 경고색(`--color-status-danger`)을 함께 얻는다(tasks.css).
   * 색만으로 가르면 색각 이상에서 구분이 사라지므로 구분선이 함께 있어야 하고, 되돌릴 수
   * 없는 조작에서 그 실패는 잘못 누른 항목으로 끝나지 않는다.
   */
  danger?: boolean;
  /**
   * §312 이 행에서는 실행할 수 없는 항목 — 눌러도 아무 일도 일어나지 않는다.
   *
   * 회색으로 만들되 **라벨이 이유까지 말한다**. 이유를 툴팁에만 두면 키보드 사용자에게는
   * 도달할 방법이 없고, 아무 말도 하지 않으면 "왜 이 행만 안 되지"로 남는다.
   */
  disabled?: boolean;
  /**
   * 이 항목에 닿는 키(`TASK_ROW_KEY_HINT`). 메뉴가 이것을 함께 그려야 키 경로가
   * 발견 가능해진다 — 아무도 찾을 수 없는 단축키는 affordance가 아니다.
   */
  hint?: string;
  /** 액션 식별자 — 아래 `runTaskTriageAction`이 이 문자열로 갈린다. */
  id: string;
  label: string;
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
  await writeAndReconcile(
    task,
    ctx,
    () =>
      applyTaskWrite(task, { field, kind: "field", value: iso }, ctx.editor),
    (written) => {
      const patch: Partial<TaskEntry> = { raw: written.raw };
      patch[field] = iso;
      useTaskStore.getState().patchTask(task.path, task.line, patch);
    },
  );
}

/**
 * 정리 메뉴가 그릴 항목. `scheduled`/`start` 하위 메뉴는 §312가 요구하지 않으므로
 * 넣지 않는다(YAGNI). 항목을 더하면 아래 switch에 짝이 되는 case를 함께 더할 것.
 *
 * 삭제는 **마지막**이다 — 파괴적 항목이 목록 가운데 있으면 키보드로 지나가다 멈추는
 * 자리가 되고, 그 자리에서 Enter는 되돌릴 수 없다.
 *
 * ‼️ `task.due`를 보고 날짜 항목을 회색으로 만들지 말 것. 파서는 날짜 이모지의 **첫**
 * 등장을 읽는데 writer는 **마지막 유효한** 것을 쓰므로, 본문에 장식용 📅가 있는
 * 행에서는 `TaskEntry.due`가 거짓 음성이 된다(dev/backlog.md P2) — 그 값으로
 * 잠그면 멀쩡한 행에서 메뉴가 죽는다. 그래서 날짜 항목들은 태스크를 보지 않는다.
 *
 * `task.tags`도 그대로 믿을 수는 없다 — `somedayVerdict`가 그 이유를 갖는다.
 * 호출부는 메뉴가 열려 있는 동안에만 (`menu.task`로) 이 함수를 부른다.
 */
export function buildTriageItems(
  t: Translate,
  task: TaskEntry,
): TaskMenuItem[] {
  const someday = somedayVerdict(task);
  return [
    {
      hint: TASK_ROW_KEY_HINT.dueToday,
      id: "dueToday",
      label: t("tasks.triage.dueToday"),
    },
    { id: "dueTomorrow", label: t("tasks.triage.dueTomorrow") },
    { id: "duePick", label: t("tasks.triage.duePick") },
    {
      // 라벨은 갈려도 id는 하나다 — 켜기와 끄기가 서로 다른 액션이 되면 디스패처가
      // 두 벌이 되고, 그 둘이 갈라지는 순간 라벨과 실제 동작이 어긋난다.
      disabled: someday === "locked",
      hint: TASK_ROW_KEY_HINT.someday,
      id: "someday",
      label: t(SOMEDAY_LABEL[someday]),
    },
    {
      // §18.18 M4 — 취소는 고리 밖이다. 체크박스는 할 일 → 진행 중 → 완료만 돌고,
      // 이 항목이 아젠다에서 `[-]`에 닿는 유일한 길이다. `someday`와 같은 모양으로
      // 라벨만 갈리고 id는 하나다 — 켜기와 끄기가 서로 다른 액션이 되면 디스패처가
      // 두 벌이 되고, 그 둘이 갈라지는 순간 라벨과 실제 동작이 어긋난다.
      id: "cancel",
      label: t(
        task.state === "cancelled"
          ? "tasks.triage.uncancel"
          : "tasks.triage.cancel",
      ),
    },
    {
      danger: true,
      hint: TASK_ROW_KEY_HINT.delete,
      id: "delete",
      label: t("tasks.triage.delete"),
    },
  ];
}

/**
 * 메뉴 항목 id → 조작. `FileTree`의 `handleContextMenuAction`과 같은 모양이다 —
 * 메뉴는 id만 올려 보내고 무엇을 할지는 전부 여기서 갈린다.
 */
export async function runTaskTriageAction(
  action: string,
  task: TaskEntry,
  ctx: TaskTriageContext,
): Promise<void> {
  switch (action) {
    case "cancel":
      // 라벨과 **같은 값**에서 읽는다(`buildTriageItems`) — 두 곳이 갈리면 "취소
      // 해제"라고 적힌 항목이 다시 취소하는 일이 생긴다.
      return writeTaskState(
        task,
        task.state === "cancelled" ? "todo" : "cancelled",
        ctx,
      );
    case "delete":
      // 확인 관문은 이 안에 있다 — 디스패처가 아니라 조작이 갖는다. 여기서 물으면
      // 확인 없이 지우는 두 번째 경로(단축키·일괄 조작)가 생기는 순간 관문이 새어 나간다.
      return confirmAndDeleteTaskLine(task, ctx);
    case "duePick":
      return pickDueDate(task, ctx);
    case "dueToday":
      return assignTaskDate(task, "due", relativeIso("t", ctx.now), ctx);
    case "dueTomorrow":
      return assignTaskDate(task, "due", relativeIso("m", ctx.now), ctx);
    case "someday": {
      // 켜기/끄기를 라벨과 **같은 값**에서 읽는다(`buildTriageItems`) — 두 곳이 갈리면
      // "해제"라고 적힌 항목이 태그를 하나 더 붙이는 일이 생긴다.
      const verdict = somedayVerdict(task);
      if (verdict === "locked") {
        // ‼️ 관문이 메뉴 라벨에만 있으면 키 한 번 경로(`s`)가 그리로 샌다. 여기서
        // 막아야 쓸 수 없는 쓰기가 아예 나가지 않고, 사용자는 왜인지도 듣는다 —
        // 비활성 항목을 볼 수 없는 경로이므로 침묵하면 "먹지 않는 키"가 된다.
        useUIStore.getState().showToast(ctx.t(SOMEDAY_LABEL.locked), "info");
        return;
      }
      return toggleTaskTag(task, SOMEDAY_TAG, verdict === "add", ctx);
    }
    default:
      // 메뉴에 항목을 더하면서 case를 잊는 것이 이 파일에서 가장 있을 법한 실수다.
      logger.warn("[tasks] unknown triage action:", action);
  }
}

/**
 * §312 체크 판정 — 네 번째 판정이고, 나머지 셋과 **같은 회계**를 탄다.
 *
 * 원래는 패널이 이 회계를 손으로 한 벌 더 갖고 있었다(같은 try/catch, 같은 세 갈래,
 * 그리고 하드코딩된 영어 실패 문구). 같은 실패에 메뉴는 한국어로, 체크박스는 영어로
 * 답하고 있었고, 회계가 두 벌이면 한쪽만 고쳐지는 것은 시간 문제였다.
 *
 * `today`는 `ctx.now`에서 푼다 — 라이브 `new Date()`를 쓰면 자정을 넘긴 직후 적히는 ✅
 * 날짜가 사용자가 보고 있는 버킷 경계와 하루 어긋난다(I4).
 *
 * `recordDoneDate`가 컨텍스트가 아니라 인자인 이유: 이것은 이 판정 하나만 쓰는 설정이고,
 * `TaskTriageContext`는 **모든** 조작이 필요로 하는 주변 값의 묶음이다.
 */
export async function advanceTaskState(
  task: TaskEntry,
  ctx: TaskTriageContext,
): Promise<void> {
  await writeTaskState(task, nextTaskState(task.state), ctx);
}

/**
 * §312/§18.18 상태를 **정확히** 그 값으로 쓴다 — 고리를 도는 체크박스와, 취소처럼
 * 고리 밖의 값을 지목하는 메뉴가 같은 회계를 타게 하는 한 자리.
 */
export async function writeTaskState(
  task: TaskEntry,
  newState: TaskState,
  ctx: TaskTriageContext,
): Promise<void> {
  const recordDoneDate = ctx.recordDoneDate;
  // §18.18 M4 `⏱`의 다음 값은 **여기서** 계산한다. 규칙(`timerForState`)이 시계를
  // 읽으므로 시간대를 아는 쪽이 해야 하고, 에디터 경로가 이미 같은 함수를 쓴다.
  // 지금 값은 스토어가 든 줄 원문에서 읽는다 — 낙관적 잠금이 대조하는 바로 그 문자열이라
  // 이 값과 실제로 고쳐질 줄이 어긋날 수 없다.
  const timer = ctx.trackTime
    ? timerForState(
        scanTaskFields(task.raw).find((s) => s.kind === "timer")?.value ?? "0m",
        newState,
        ctx.now,
      )
    : null;
  await writeAndReconcile(
    task,
    ctx,
    () =>
      applyTaskWrite(
        task,
        {
          kind: "state",
          newState,
          recordDoneDate,
          timer,
          today: relativeIso("t", ctx.now),
        },
        ctx.editor,
      ),
    (written) => {
      // 종료 스탬프는 `recordDoneDate`로 다시 계산하지 않고 **실제로 쓰인 줄**에서
      // 읽는다 — `apply_state`는 그 설정이 꺼져 있으면 기존 날짜를 그대로 보존하므로
      // 재계산은 그 값과 어긋난다. §18.18 M4부터 `❌`도 같은 이유로 여기서 읽는다.
      const doneMatch = /✅(\d{4}-\d{2}-\d{2})/.exec(written.raw);
      const cancelMatch = /❌(\d{4}-\d{2}-\d{2})/.exec(written.raw);
      useTaskStore.getState().patchTask(task.path, task.line, {
        cancelled: cancelMatch ? cancelMatch[1] : null,
        done: doneMatch ? doneMatch[1] : null,
        raw: written.raw,
        state: newState,
        // 스탬프와 같은 이유로 **쓰인 줄에서** 읽는다 — 위에서 계산한 값은 기록이
        // 꺼져 있으면 `null`이고, 그때 줄에 남아 있는 옛 값과 어긋난다.
        timer:
          scanTaskFields(written.raw).find((s) => s.kind === "timer")?.value ??
          null,
      });
    },
  );
}

/**
 * §312 태그 토글 — `on=false`는 제거.
 *
 * 줄에 무엇을 쓸지는 전부 Rust가 정한다(`apply_tag`): 삽입 위치(§303 순서상 이모지 필드
 * 앞), 경계 판정(`#someday`는 `#someday-maybe`가 아니다), 공백 흡수. 여기서 그 규칙을
 * 재구현하면 디스크 경로와 문서 경로가 갈린다.
 */
export async function toggleTaskTag(
  task: TaskEntry,
  tag: string,
  on: boolean,
  ctx: TaskTriageContext,
): Promise<void> {
  // ‼️ 라벨의 판정(`somedayVerdict` — TS)과 실제 쓰기(`apply_tag` — Rust)는 서로 다른
  // 구현이 같은 규칙을 보는 것이다. 그 둘이 어긋나면 쓰기는 성공했는데 줄이 **한 바이트도
  // 바뀌지 않는다**. 그 결과로 스토어를 패치하면 행이 한 번 깜빡이고 다음 재스캔에서
  // 원래대로 돌아온다 — 사용자에게는 "먹었다가 취소되는" 조작으로 보이고, 왜인지 알 방법이
  // 없다. 성공의 정의를 "예외가 없었다"가 아니라 "줄이 달라졌다"로 두는 관문이다.
  let unchanged = false;
  await writeAndReconcile(
    task,
    ctx,
    async () => {
      const result = await applyTaskWrite(
        task,
        { kind: "tag", on, tag },
        ctx.editor,
      );
      // 비교 기준은 낙관적 잠금과 같다(`isSameLine`) — 끝 공백만 다른 것을 "바뀌었다"고
      // 세면 관문이 그 줄에서만 새어 나간다.
      unchanged = result.kind !== "stale" && isSameLine(result.raw, task.raw);
      return result;
    },
    (written) => {
      if (unchanged) return;
      useTaskStore.getState().patchTask(task.path, task.line, {
        raw: written.raw,
        tags: on ? [...task.tags, tag] : task.tags.filter((x) => x !== tag),
        text: applyTagToText(task.text, tag, on),
      });
    },
  );
  // 디스크 경로도 여기로 온다 — 그쪽은 `writeAndReconcile`이 파일을 다시 읽어 스토어를
  // 사실과 맞추므로 남는 문제는 침묵뿐이다.
  if (unchanged) {
    useUIStore
      .getState()
      .showToast(ctx.t("tasks.triage.tagUnchanged", { tag }), "info");
  }
}

/**
 * 표시용 본문에서 태그를 켜고 끈다 — **줄 원문이 아니다**(그것은 Rust가 준 값을 그대로
 * 쓴다). 파서는 태그를 본문에 **남긴 채** 수집만 하므로(parse.rs) 아젠다 행에 `#someday`가
 * 그대로 보인다. `tags`만 갈아끼우면 해제한 태그가 행에는 계속 보여 "먹지 않았다"로 읽힌다.
 *
 * 경계 판정을 흉내 내지 않고 **공백으로 끊긴 토큰 전체**만 비교한다 — 규칙을 반쯤 베낀
 * 정규식을 두는 것보다 낫고, 어긋나 봐야 저장·재인덱싱이 파서의 값으로 곧 덮어쓴다.
 * `text`는 파서가 이미 공백을 접어 둔 문자열이다(parse.rs의 `split_whitespace`).
 */
function applyTagToText(text: string, tag: string, on: boolean): string {
  const token = `#${tag}`;
  const words = text.split(/\s+/).filter((w) => w !== "" && w !== token);
  if (on) words.push(token);
  return words.join(" ");
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
        type: "date",
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

/**
 * §312 이 행의 `#someday`를 지금 어떻게 할 수 있는가.
 *
 * `task.tags`만 보면 안 되는 이유(MODERATE-1): 읽는 쪽이 그 줄에서 읽어낸 이름과 쓰는
 * 쪽이 그 줄에서 찾을 수 있는 이름이 다를 수 있다. 다르면 그 행은 필터에서 "미뤄진 것"으로
 * 숨겨지는데 해제는 줄을 한 바이트도 바꾸지 못한다 — 아젠다에서 영원히 빠져나올 수 없는
 * 행이 된다. 두 어휘 중 **쓰는 쪽**을 봐야 라벨과 동작이 같은 사실을 본다(`lineHasTag`).
 *
 * ‼️ 이 결함을 만든 가장 흔한 형태(`#someday-maybe` — 읽는 쪽만 하이픈에서 끊었다)는
 * 이제 닫혔다. 그래도 이 관문은 남는다: 두 어휘가 유니코드 가장자리에서 아직 다르다.
 * `md::INLINE_TAG_RE`의 `\w`는 결합 문자(`\p{M}`)와 `\p{Pc}`를 포함하지만
 * `is_tag_char`의 `is_alphanumeric()`은 포함하지 않고, 반대로 `\p{Nl}`·`\p{No}`는
 * `is_alphanumeric()`만 포함한다. 실무에서 만날 일은 드물지만 **관문을 지우면 그때
 * 죽은 조작이 조용히 돌아온다.** 여기서 지키는 것은 정직함이다: 할 수 없는 일을
 * 약속하지 않는다.
 */
function somedayVerdict(task: TaskEntry): SomedayVerdict {
  if (!task.tags.includes(SOMEDAY_TAG)) return "add";
  return lineHasTag(task.raw, SOMEDAY_TAG) ? "remove" : "locked";
}
