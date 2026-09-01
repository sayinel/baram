// §318/§18.18 상태 전이 하나가 줄에 무엇을 하는지 — **두 진입점이 함께 보는 한 자리**.
//
// 이 파일이 있는 이유는 상태 전이가 이 코드베이스에서 두 번 구현돼 있기 때문이다:
//
//   `task-triage.ts:writeTaskState`   아젠다 · vim · 편집 모달 (디스크/문서/소스)
//   `task-item.ts:writeState`         에디터 체크박스 (PM 트랜잭션, 디스크를 안 탄다)
//
// 그 둘이 갈라진 것은 사고가 아니다 — 에디터 경로가 디스크를 타지 않는 것이 존재
// 이유다. 갈라도 되는 것은 **어디에 쓰는가**뿐이고, **무엇을 쓰는가**는 하나여야 한다.
// M4에서 `⏱` 규칙이 두 벌이 될 뻔했고, §318이 거기에 날짜까지 더하면서 "체크박스로
// 누르면 굴러가는데 아젠다에서 누르면 안 굴러간다" 같은 결함이 설 자리가 생겼다.

import type { TaskState } from "../../ipc/types";
import type { RollableDateField, TaskRoll } from "./task-recurrence";

import { scanTaskFields } from "./task-field-scan";
import { rollForState } from "./task-recurrence";
import { timerForState } from "./task-timer";

export interface ResolvedStateWrite {
  /** §318 굴린 날짜. 굴리지 않으면 `undefined` — 백엔드가 날짜를 건드리지 않는다. */
  dates?: Partial<Record<RollableDateField, string>>;
  /**
   * 줄에 **실제로 쓰는** 상태. 굴릴 때는 요청과 다르다(`todo`) — 다음 회차는 아직
   * 하지 않은 일이다.
   */
  newState: TaskState;
  /**
   * ‼️ 굴릴 때는 **항상 참**이다. `Todo.stamp_field()`가 `None`이라 이 값은
   * "기존 ✅/❌를 뗀다"만 뜻하고 새 스탬프를 찍지 않는다. 거짓으로 넘기면
   * `apply_state`가 일찍 돌아가 스탬프를 떼지 못해, `[ ]`인데 완료일이 붙은 —
   * 자기가 끝났는지에 대해 두 가지를 말하는 — 줄이 남는다.
   */
  recordDoneDate: boolean;
  /** 굴렸다면 그 결과. 토스트가 사용자에게 보여 줄 날짜를 여기서 읽는다. */
  roll: null | TaskRoll;
  /** §18.18 M4 `⏱`의 다음 값. `null`은 "건드리지 말라". */
  timer: null | string;
}

/**
 * `requested` 상태로 가려는 조작이 줄에 무엇을 해야 하는가.
 *
 * 순수 함수다 — 파일도 문서도 건드리지 않고, 시계는 인자로 받는다.
 */
export function resolveStateWrite(
  requested: TaskState,
  line: string,
  opts: { now: Date; recordDoneDate: boolean; trackTime: boolean },
): ResolvedStateWrite {
  const roll = rollForState(requested, line);
  // 굴리는 전이는 완료가 아니라 **다음 회차의 시작**이다.
  const newState = roll ? "todo" : requested;
  const current =
    scanTaskFields(line).find((span) => span.kind === "timer")?.value ?? null;

  return {
    dates: roll?.dates,
    newState,
    recordDoneDate: roll ? true : opts.recordDoneDate,
    roll,
    timer: nextTimer(current, newState, roll !== null, opts),
  };
}

/**
 * 새 회차의 시계는 **0에서 시작한다** — 이전 회차에 쓴 시간은 이 회차의 것이 아니다.
 *
 * ‼️ 필드가 없던 줄에는 만들지 않는다(`null`). `⏱`를 켠 사용자라도 굴리기는 그가 이미
 * 적은 것만 바꾼다는 것이 §318이 설정 없이 기본 켜짐일 수 있는 근거다 — 여기서 필드를
 * 새로 만들면 그 근거가 깨진다.
 *
 * **대가**: 굴리면 이전 회차의 누적이 사라진다. 반복 태스크의 총 시간을 남기려면 §303
 * 표에 필드가 하나 더 필요하고, 그것은 별건이다.
 */
function nextTimer(
  current: null | string,
  arrived: TaskState,
  rolled: boolean,
  opts: { now: Date; trackTime: boolean },
): null | string {
  if (!opts.trackTime) return null;
  if (rolled) return current === null ? null : "0m";
  // 굴리지 않는 전이는 M4 그대로다. `"0m"` 기본값이 필드 없는 줄에 시계를 만든다 —
  // `doing`으로 옮기는 것이 그 필드가 생기는 자리이고, 그것이 M4의 설계다.
  return timerForState(current ?? "0m", arrived, opts.now);
}
