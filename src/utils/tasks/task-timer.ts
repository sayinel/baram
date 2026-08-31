// §18.18 M4 시간 기록 — `⏱` 필드의 값 문법과 상태 연동 규칙.
//
// 한 줄 모델을 지킨다(설계 §18.18). 값은 **누적 시간**이고, 진행 중이면 그 뒤에
// `+시작시각`이 붙는다:
//
//     ⏱1h27m                     멈춤 — 지금까지 1시간 27분
//     ⏱1h27m+2026-08-31T14:03    진행 중 — 저 시각부터 다시 재는 중
//
// ‼️ 구분자가 `@`가 아니라 `+`인 이유는 취향이 아니다. 직렬화가 `@`를 `\@`로 이스케이프해
// (GFM 이메일 자동링크 방어) 파일에 백슬래시가 남는다 — 우리 왕복은 견디지만 남의 도구가
// 읽을 때는 그냥 깨진 값이다. `+` `/` `:` 등은 그대로 나간다. 실측으로 고른 값이고,
// `roundtrip-task-timer.test.ts`가 그 성질을 못박는다. (`+`는 읽기도 맞다 — "쌓인 만큼,
// 더하기 저 시각부터".)
//
// ‼️ 누적을 **값 안에 들고 있는** 것이 핵심이다. 설계 원문은 "진행 중이면 시작 시각,
// 멈추면 누적"이라 읽히는데, 그대로 하면 멈췄다 다시 시작하는 순간 누적이 시작 시각에
// 덮여 사라진다. 한 필드로 두 사실을 나르는 대신 파일에 이모지를 하나 더 들이는 안도
// 있었으나(사용자 결정, 2026-08-31), §303 표에 자리와 순서 규칙이 둘 늘어난다.

import type { TaskState } from "../../ipc/types";

/**
 * 파일에 쓰는 이모지 — **U+23F1 하나**, variation selector(U+FE0F) 없음.
 *
 * ‼️ 이 필드만 이 문제가 있다. §303의 다른 이모지는 전부 코드포인트 하나인데 `⏱`는
 * `⏱️`(U+23F1 U+FE0F)로 쓰이는 것이 더 흔하다. 그런데 Rust `normalize_line`이 파싱
 * 전에 U+FE0F를 지우고, 쓰기 경로(`replace_line`)는 그 **정규화된 줄**을 파일에 되쓴다 —
 * 즉 FE0F를 붙여 저장해도 첫 쓰기에서 조용히 떨어진다. 그래서 canonical은 짧은 쪽이고,
 * 읽을 때만 둘 다 받는다(`TIMER_EMOJI_RE`).
 */
export const TIMER_EMOJI = "⏱";

/** 읽기용 — 붙어 있는 variation selector까지 한 덩어리로 본다. */
export const TIMER_EMOJI_RE = /⏱️?/;

export interface TaskTimer {
  /** 지금까지 쌓인 분. 진행 중인 구간은 **포함하지 않는다**. */
  accumulatedMinutes: number;
  /** 진행 중이면 시작 시각(`2026-08-31T14:03`), 아니면 `null`. */
  startedAt: null | string;
}

/**
 * 지금까지의 총 분 — 멈춘 누적 + 진행 중이라면 그 구간까지.
 *
 * 표시 전용이다. 파일에 쓰는 값은 멈출 때만 갱신되므로, 진행 중인 태스크의 화면 숫자와
 * 파일의 숫자는 다르다 — 그것이 "껐다 켜도 유지된다"의 대가이자 목적이다.
 */
export function elapsedMinutes(timer: TaskTimer, now: Date): number {
  if (timer.startedAt === null) return timer.accumulatedMinutes;
  const started = parseStamp(timer.startedAt);
  if (started === null) return timer.accumulatedMinutes;
  return timer.accumulatedMinutes + minutesBetween(started, now);
}

/** `{ 87, null }` → `"1h27m"`. 진행 중이면 `"1h27m@2026-08-31T14:03"`. */
export function formatTimer(timer: TaskTimer): string {
  const total = Math.max(0, Math.round(timer.accumulatedMinutes));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  // 0은 `0m`이다 — 빈 문자열이면 `⏱@2026-…`이 되어 값이 없는 필드처럼 보인다.
  const duration =
    hours === 0
      ? `${minutes}m`
      : minutes === 0
        ? `${hours}h`
        : `${hours}h${minutes}m`;
  return timer.startedAt === null
    ? duration
    : `${duration}${RUNNING_SEPARATOR}${timer.startedAt}`;
}

/**
 * `⏱` 뒤의 값을 읽는다. 문법에 맞지 않으면 `null`.
 *
 * ‼️ 모르는 모양을 **0으로 읽지 않는다**. 그랬다면 다른 도구가 적은 `⏱30분` 같은 값을
 * 우리가 `0m`으로 덮어썼을 것이다 — 읽지 못하는 값은 건드리지 않는 편이 옳다
 * (`timerForState`가 `null`을 그대로 흘려보내는 이유).
 */
export function parseTimer(value: string): null | TaskTimer {
  const [duration, stamp] = splitAt(value.trim());
  const match = DURATION_RE.exec(duration);
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  if (stamp !== null && parseStamp(stamp) === null) return null;

  return {
    accumulatedMinutes: Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0),
    startedAt: stamp,
  };
}

/** `Date` → `2026-08-31T14:03`. 로컬 시각이고 분까지만 — 초는 기록의 잡음이다. */
export function stampOf(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`;
}

/**
 * 상태가 `state`가 된 뒤의 값. 바뀔 것이 없으면 들어온 값을 그대로 돌려준다.
 *
 * ‼️ 전이(from → to)가 아니라 **도달한 상태**만 본다. 그래야 손으로 고쳐 어긋난 줄이
 * 저절로 맞는다: `[x]`인데 타이머가 돌고 있는 줄은 다음 조작에서 멈춘다. 전이로 쓰면
 * 그런 줄은 영원히 돌고, 누적은 영원히 늘어난다.
 *
 * 규칙 하나: **타이머는 `doing`일 때만 돈다.**
 */
export function timerForState(
  value: string,
  state: TaskState,
  now: Date,
): string {
  const timer = parseTimer(value);
  if (timer === null) return value;

  if (state === "doing") {
    // 이미 돌고 있으면 시작 시각을 **다시 찍지 않는다** — 찍으면 그 사이의 시간이
    // 누적에 들어가지 못한 채 사라진다. `[/]`에서 `[/]`로 오는 조작(필드 편집 등)이
    // 이 경로를 다시 지나간다.
    if (timer.startedAt !== null) return value;
    return formatTimer({ ...timer, startedAt: stampOf(now) });
  }

  if (timer.startedAt === null) return value;
  return formatTimer({
    accumulatedMinutes: elapsedMinutes(timer, now),
    startedAt: null,
  });
}

/** `1h27m+2026-08-31T14:03` → `["1h27m", "2026-08-31T14:03"]`. 없으면 뒤는 `null`. */
function splitAt(value: string): [string, null | string] {
  const at = value.indexOf(RUNNING_SEPARATOR);
  return at === -1 ? [value, null] : [value.slice(0, at), value.slice(at + 1)];
}

/** 두 시각 사이의 분. 음수는 0으로 — 시계를 되돌린 파일이 누적을 깎지 못하게 한다. */
function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}

/** `2026-08-31T14:03` → `Date`. 달력에 없는 값이면 `null`. */
function parseStamp(stamp: string): Date | null {
  const m = STAMP_RE.exec(stamp);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi);
  // 롤오버 검사 — `2026-02-31T25:99`가 3월의 어느 시각이 되어서는 안 된다.
  return date.getMonth() === mo - 1 &&
    date.getDate() === d &&
    date.getHours() === h &&
    date.getMinutes() === mi
    ? date
    : null;
}

/** `1h27m` · `2h` · `45m`. 둘 다 없으면(`""`) 매치는 되지만 값이 아니다 — 위에서 거른다. */
const DURATION_RE = /^(?:(\d{1,5})h)?(?:(\d{1,4})m)?$/;

const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** 누적과 시작 시각 사이. 파일 머리 주석의 이유로 `@`가 아니다. */
const RUNNING_SEPARATOR = "+";
