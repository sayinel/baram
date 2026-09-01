// §318 반복 회차 굴리기 — `🔁` 규칙의 문법과 다음 회차 계산.
//
// M4까지 `🔁`는 사용자를 위한 메모였다. 앱이 읽어 칩으로 그렸지만 그 값에 따라 아무
// 일도 하지 않았다. 이 모듈이 그 값을 **행동**으로 바꾼다: 반복 태스크를 완료하거나
// 취소하면 날짜가 다음 회차로 밀리고 상태가 `[ ]`로 돌아간다(줄은 하나 그대로다).
//
// ‼️ **이 규칙은 TypeScript에만 산다.** M4 `timerForState`가 세운 선례다 — 달력을
// 읽는 규칙은 시간대를 아는 쪽이 갖고, Rust는 계산된 값을 받아 자리만 정한다. Rust에
// 포팅하면 에디터 경로(디스크를 타지 않는다)와 아젠다 경로가 서로 다른 달력을 갖는다.
//
// ‼️ 저장 문법은 **영어 하나**다. `🔁`가 붙은 줄은 Obsidian Tasks 같은 남의 도구도
// 읽으므로 지역화하면 상호운용이 깨진다 — §303이 이모지 포맷을 canonical로 고른 것과
// 같은 이유다. 화면 표시(칩·툴팁)만 로케일을 탄다.

import type { TaskState } from "../../ipc/types";

import { makeCalendarDate, toIsoDate } from "./task-date-input";
import { scanTaskFields } from "./task-field-scan";

export interface Recurrence {
  /** `on the 3rd` — 1..31. 없으면 `null`. `month`에서만 유효하다. */
  dayOfMonth: null | number;
  /** `every 2 weeks`의 2. 생략하면 1. */
  interval: number;
  unit: "day" | "month" | "week" | "weekday" | "year";
  /** `on Monday` — 0=일 … 6=토. 없으면 `null`. `week`에서만 유효하다. */
  weekday: null | number;
}

/** 굴릴 때 함께 움직이는 날짜 필드. `➕` 생성일은 일정이 아니라 기록이라 빠진다. */
export type RollableDateField = "due" | "scheduled" | "start";

export interface TaskRoll {
  /** 밀린 날짜들. 줄에 있던 것만 담긴다. */
  dates: Partial<Record<RollableDateField, string>>;
  /** 기준 필드의 새 값 — 토스트가 사용자에게 보여 주는 날짜다. */
  next: string;
}

/**
 * `from` 다음 회차의 ISO 날짜. `from`이 달력에 없는 날이면 `null`.
 *
 * ‼️ **항상 앞으로 간다.** 제자리에 서면 굴린 것이 아니고, 뒤로 가면 완료할 때마다
 * 기한 초과가 깊어진다. 요일·날짜 앵커가 이미 맞는 날에서 출발해도 다음 것으로 넘어간다.
 */
export function nextDate(rule: Recurrence, fromIso: string): null | string {
  const from = parseIsoDate(fromIso);
  if (from === null) return null;

  switch (rule.unit) {
    case "day":
      return toIsoDate(addDays(from, rule.interval));
    case "month":
      return toIsoDate(addMonths(from, rule.interval, rule.dayOfMonth));
    case "week":
      return toIsoDate(addWeeks(from, rule));
    case "weekday":
      return toIsoDate(nextWeekday(from));
    case "year":
      // 연은 "12개월"로 계산한다 — 2/29에서 평년으로 갈 때의 접기가 월 계산과
      // 같은 규칙을 타야 한다(2029-02-28이지 2029-03-01이 아니다).
      return toIsoDate(addMonths(from, rule.interval * 12, null));
  }
}

/**
 * `🔁` 뒤의 규칙 텍스트를 읽는다. 문법에 맞지 않으면 `null`.
 *
 * ‼️ **모르는 모양을 그럴듯한 것으로 읽지 않는다.** M4 `parseTimer`가 `⏱30분`을
 * `0m`으로 읽지 않는 것과 같은 규칙이다 — 추측해서 굴리면 남의 도구가 적은 줄을
 * 우리가 고쳐 쓴다. `null`이면 그 줄은 평범하게 완료될 뿐이고, 굴리지 않았다는
 * 사실은 칩이 말한다(§318).
 */
export function parseRecurrence(rule: string): null | Recurrence {
  const match = RULE_RE.exec(rule.trim().toLowerCase().replace(/\s+/g, " "));
  if (!match) return null;

  const [, count, word, ordinal, weekdayName] = match;
  const interval = count === undefined ? 1 : Number(count);
  if (interval < 1) return null;

  const unit = UNIT[word];
  // 도달 불가다(정규식이 `UNIT`의 키만 받는다). 표 둘이 어긋나는 날의 방어로 남긴다.
  if (unit === undefined) return null;

  const dayOfMonth = ordinal === undefined ? null : Number(ordinal);
  const weekday =
    weekdayName === undefined ? null : (WEEKDAY[weekdayName] ?? null);
  if (weekdayName !== undefined && weekday === null) return null;
  if (dayOfMonth !== null && (dayOfMonth < 1 || dayOfMonth > 31)) return null;

  // 앵커는 자기 단위에만 붙는다. `every week on the 3rd`는 "몇 번째 주의 3일"이라는
  // 뜻이 될 수 없고, `every month on Monday`는 어느 월요일인지 말하지 않는다.
  if (weekday !== null && unit !== "week") return null;
  if (dayOfMonth !== null && unit !== "month") return null;
  // 평일은 "다음 영업일"이라는 한 가지 뜻뿐이다 — `every 2 weekdays`는 받지 않는다.
  if (unit === "weekday" && (count !== undefined || weekday !== null)) {
    return null;
  }

  return { dayOfMonth, interval, unit, weekday };
}

/**
 * 상태가 `state`가 된 줄을 굴린 결과. 굴릴 것이 없으면 `null`.
 *
 * ‼️ M4 `timerForState`와 같은 모양이다 — 전이(from → to)가 아니라 **도달한 상태**만
 * 본다. 그리고 **시계를 받지 않는다**: 기준일은 줄에 적힌 날짜이지 오늘이 아니라는
 * 설계 결정(§318)이 이 시그니처로 강제된다. "매주 월요일"이 늦게 완료해도 월요일에
 * 서는 이유가 여기 있다.
 *
 * 굴리지 않는 경우 셋 — 규칙이 없다 · 규칙을 못 읽는다 · 밀 날짜가 하나도 없다.
 * 셋 다 조용한 무동작이라 사용자에게는 고장으로 보인다. 칩이 뒤의 둘을 말한다.
 */
export function rollForState(state: TaskState, line: string): null | TaskRoll {
  if (state !== "cancelled" && state !== "done") return null;

  const spans = scanTaskFields(line);
  const rule = spans.find((span) => span.kind === "recurrence")?.value;
  if (rule === undefined) return null;
  const parsed = parseRecurrence(rule);
  if (parsed === null) return null;

  const present = ROLLABLE.map(
    (kind) =>
      [kind, spans.find((span) => span.kind === kind)?.value ?? null] as const,
  );
  // 기준일 우선순위 📅 > ⏳ > 🛫 — `ROLLABLE`의 순서가 그 표다.
  const anchor = present.find(([, value]) => value !== null)?.[1] ?? null;
  if (anchor === null) return null;

  const next = nextDate(parsed, anchor);
  if (next === null) return null;
  const delta = daysBetween(anchor, next);

  // 셋을 **같은 delta**로 민다 — "시작 이틀 전, 기한 당일"이 회차마다 유지되어야 한다.
  const dates: TaskRoll["dates"] = {};
  for (const [kind, value] of present) {
    if (value === null) continue;
    const shifted = shiftIso(value, delta);
    // 줄에 달력에 없는 날짜가 적혀 있다. 한 필드라도 못 밀면 아무것도 밀지 않는다 —
    // 반쯤 굴린 줄은 어느 회차인지 말하지 못한다.
    if (shifted === null) return null;
    dates[kind] = shifted;
  }
  return { dates, next };
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  // `setDate`는 달·해 경계를 알아서 넘긴다. 밀리초 산술은 DST 전환일에 하루를 잃는다.
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * `months`개월 뒤. 목표 달에 없는 일자는 **그 달의 마지막 날로 접는다**.
 *
 * `anchorDay`가 있으면 그 일자를, 없으면 출발일의 일자를 쓴다. 이 차이가 설계가
 * 받아들인 drift와 그 탈출구다: `every month`로 1/31에서 굴리면 2/28이고 다음은
 * 3/28이지만(접힌 뒤 되돌아가지 않는다), `every month on the 31st`는 2/28에서
 * 3/31로 스스로 회복한다.
 */
function addMonths(from: Date, months: number, anchorDay: null | number): Date {
  const year = from.getFullYear();
  // `month`가 11을 넘거나 음수여도 `Date`가 해를 넘겨 준다 — 직접 나눗셈하지 않는다.
  const month = from.getMonth() + months;
  const day = anchorDay ?? from.getDate();
  return new Date(year, month, Math.min(day, lastDayOfMonth(year, month)));
}

function addWeeks(from: Date, rule: Recurrence): Date {
  if (rule.weekday === null) return addDays(from, rule.interval * 7);
  // 그 요일이 **다음에** 오는 날까지(오늘이 그 요일이면 7일 뒤), 그 뒤에 남은 주를 더한다.
  const step = ((rule.weekday - from.getDay() + 6) % 7) + 1;
  return addDays(from, step + (rule.interval - 1) * 7);
}

/** 두 ISO 날짜 사이의 일수. 둘 다 이미 유효하다고 가정한다. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (from === null || to === null) return 0;
  // DST 전환이 낀 구간은 23·25시간이 되므로 반올림한다 — 자름이 아니다.
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function lastDayOfMonth(year: number, month: number): number {
  // 다음 달의 0일 = 이 달의 마지막 날. `month + 1`이 12여도 `Date`가 넘겨 준다.
  return new Date(year, month + 1, 0).getDate();
}

/** 주말을 건너뛴 다음 날. 금요일에서 부르면 월요일이다. */
function nextWeekday(from: Date): Date {
  let d = addDays(from, 1);
  while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
  return d;
}

/** `YYYY-MM-DD` → `Date`. 달력에 없는 날짜면 `null`. */
function parseIsoDate(iso: string): Date | null {
  const m = ISO_RE.exec(iso);
  return m ? makeCalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

function shiftIso(iso: string, days: number): null | string {
  const d = parseIsoDate(iso);
  return d === null ? null : toIsoDate(addDays(d, days));
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 기준일 우선순위이자 굴리는 필드 목록. **순서가 곧 우선순위다** — 앞의 것이 있으면
 * 그것이 delta를 정하고 나머지는 따라간다.
 */
const ROLLABLE: readonly RollableDateField[] = ["due", "scheduled", "start"];

/**
 * §318 규칙 문법. 앵커(`on ...`)는 선택이고, 어느 단위에 붙을 수 있는지는
 * `parseRecurrence`가 따로 검사한다 — 정규식에 넣으면 읽을 수 없게 된다.
 */
const RULE_RE =
  /^every(?: (\d{1,3}))? (day|days|week|weeks|weekday|month|months|year|years)(?: on (?:the (\d{1,2})(?:st|nd|rd|th)|([a-z]+)))?$/;

const UNIT: Record<string, Recurrence["unit"] | undefined> = {
  day: "day",
  days: "day",
  month: "month",
  months: "month",
  week: "week",
  weekday: "weekday",
  weeks: "week",
  year: "year",
  years: "year",
};

const WEEKDAY: Record<string, number | undefined> = {
  friday: 5,
  monday: 1,
  saturday: 6,
  sunday: 0,
  thursday: 4,
  tuesday: 2,
  wednesday: 3,
};
