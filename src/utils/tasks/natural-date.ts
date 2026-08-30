// §308 M3-c 태스크 줄에 적은 **말**에서 날짜를 알아본다 (한국어·영어).
//
// Todoist Quick Add의 핵심은 파서 성능이 아니라 **입력 중에 인식 결과를 보여주는 것**이다
// (설계 §18.11). 그래서 범위를 좁게 잡는다: 오늘/내일/모레 · 요일 · N일 후 · 절대 날짜.
// 넓은 파서는 틀릴 자리가 넓고, 틀린 인식은 사용자 글자를 먹는 조작으로 이어진다.
//
// ‼️ 여기서 날짜 **산술을 하지 않는다.** 모든 표현은 `resolveDateInput`이 이미 아는
// 어휘(`today` · `+3` · `2026-09-15` · `9/15`)로 번역되고, 계산은 그쪽 한 자가 한다.
// 그래야 "말로 적은 내일"과 "`due:m`으로 적은 내일"이 같은 날을 가리킨다는 것이 구조적으로
// 보장된다 — 두 파서가 각자 날짜를 세면 자정 근처나 월말에서 갈린다.
//
// ‼️ 커서에서 **끝나는** 구간만 인식한다. 줄 어디서나 알아보면 `오늘의 할 일 정리`의
// `오늘`에 밑줄이 서고, 그 줄에서 Tab으로 들여쓰기를 하려던 사용자가 글자를 잃는다.
// 확정 키가 목록 들여쓰기와 같은 키라서 그 사고는 실제로 일어난다. 좁게 시작한다.

import { resolveDateInput } from "./task-date-input";
import { scanTaskFields } from "./task-field-scan";

export interface DateGuess {
  /** 인식한 구간의 시작(문단 텍스트 오프셋). */
  from: number;
  /** ISO 날짜. */
  iso: string;
  /** 구간의 끝 — 언제나 커서 자리다. */
  to: number;
}

/**
 * `at`에서 **끝나는** 날짜 표현을 찾는다. 없으면 `null`.
 *
 * 로케일로 가르지 않는다 — 한국어 UI로 영어 메모를 적는 사람이 있고, 두 어휘가 겹치지도
 * 않는다. 겹치지 않는 어휘를 로케일로 나누면 얻는 것 없이 놓치는 것만 생긴다.
 */
export function guessTrailingDate(
  text: string,
  at: number,
  today: Date,
): DateGuess | null {
  const head = text.slice(0, Math.max(0, Math.min(at, text.length)));

  for (const { re, value } of PATTERNS) {
    const m = re.exec(head);
    if (!m) continue;
    const from = head.length - m[0].length;
    // 앞이 공백이거나 줄 처음이어야 한다 — `xtoday`의 꼬리를 알아보면 안 된다.
    if (from > 0 && !/\s/.test(head[from - 1])) continue;

    const iso = resolveDateInput(value(m, today), today);
    if (iso === null) continue;

    // 이미 필드인 자리는 건드리지 않는다. `📅 2026-08-30`의 날짜 부분이 여기 걸리면
    // 확정이 `📅 📅2026-08-30`을 만든다.
    const guess = { from, iso, to: head.length };
    if (overlapsField(text, guess)) continue;
    return guess;
  }
  return null;
}

/** `today`에서 그 요일까지 며칠인가 — 오늘이면 0. `다음 주`는 거기에 이레를 더한다. */
function daysToWeekday(today: Date, target: number, nextWeek: boolean): string {
  const diff = (target - today.getDay() + 7) % 7;
  return `+${diff + (nextWeek ? 7 : 0)}`;
}

/** 인식한 구간이 이미 이모지 필드의 일부인가. */
function overlapsField(text: string, guess: DateGuess): boolean {
  return scanTaskFields(text).some(
    (span) => guess.from < span.to && span.from < guess.to,
  );
}

/** 요일 이름 → `Date.getDay()` 값. 배열 인덱스가 곧 그 값이다. */
const EN_WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const KO_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 인식하는 표현 전부. 각 항목은 자기를 `resolveDateInput`의 어휘로 번역한다.
 *
 * ‼️ 순서가 규칙이다. 긴 표현이 먼저 와야 `다음 주 월요일`이 `월요일`로 잘리지 않는다.
 * 정규식은 모두 `$`로 묶여 있다 — 커서에서 끝나는 것만 본다.
 */
const PATTERNS: {
  re: RegExp;
  value: (m: RegExpExecArray, today: Date) => string;
}[] = [
  // 절대 날짜는 `resolveDateInput`이 이미 읽는 모양 그대로 넘긴다.
  { re: /\d{4}-\d{2}-\d{2}$/, value: (m) => m[0] },
  { re: /\d{1,2}\/\d{1,2}$/, value: (m) => m[0] },
  // `9월 15일` — `M/D`로 바꿔 넘기면 "지났으면 내년" 규칙까지 그쪽 것을 쓴다.
  { re: /(\d{1,2})월\s*(\d{1,2})일$/, value: (m) => `${m[1]}/${m[2]}` },

  { re: /오늘$/, value: () => "today" },
  { re: /내일$/, value: () => "+1" },
  { re: /모레$/, value: () => "+2" },
  { re: /어제$/, value: () => "yesterday" },
  { re: /\btoday$/i, value: () => "today" },
  { re: /\btomorrow$/i, value: () => "+1" },
  { re: /\byesterday$/i, value: () => "yesterday" },

  { re: /(\d{1,3})일\s*(?:후|뒤)$/, value: (m) => `+${m[1]}` },
  { re: /\bin\s+(\d{1,3})\s+days?$/i, value: (m) => `+${m[1]}` },

  {
    re: /(다음\s*주\s*)?([일월화수목금토])요일$/,
    value: (m, today) =>
      daysToWeekday(today, KO_WEEKDAYS.indexOf(m[2]), Boolean(m[1])),
  },
  {
    re: /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i,
    value: (m, today) =>
      daysToWeekday(
        today,
        EN_WEEKDAYS.indexOf(m[2].toLowerCase()),
        Boolean(m[1]),
      ),
  },
];
