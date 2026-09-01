// §308 표시 절반 — 한 줄에서 이모지 필드의 **구간**을 찾는다.
//
// 문서 모델을 바꾸지 않는다. 이 구간을 데코레이션이 숨기고 그 자리에 칩을 그린다.
// 어휘는 재정의하지 않는다: 트리거는 `task-field-tokens.ts`, 이모지와 그 종류는
// `task-field-order.ts`가 유일한 출처다 — 여기서 다시 적으면 에디터 입력 규칙·캡처·
// 표시가 서로 다른 어휘를 갖게 된다.

import type { TaskFieldKind } from "./task-field-order";

import { CANONICAL_DATE_FIELDS, RECURRENCE_EMOJI } from "./task-field-order";
import { PRIORITY_EMOJI } from "./task-field-tokens";
import { parseTimer, TIMER_EMOJI_RE } from "./task-timer";

export type { TaskFieldKind };

export interface TaskFieldSpan {
  /**
   * 이 구간을 연 이모지. **호출자가 텍스트에서 다시 잘라내면 안 된다** — UTF-16
   * 길이가 제각각이라(`📅🛫🔺🔽`=2, `⏳➕✅❌⏫⏬`=1) 고정 길이로 자르면 틀린다.
   */
  emoji: string;
  /** UTF-16 코드 유닛 인덱스 — ProseMirror 위치 계산이 그대로 더한다. */
  from: number;
  kind: TaskFieldKind;
  to: number;
  /** 날짜 필드는 ISO 날짜, 우선순위는 마커 자체. */
  value: string;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `text`에서 이모지 필드 구간을 등장 순서로 찾는다.
 *
 * 유효한 값이 뒤따르지 않는 이모지는 **구간이 아니다** — 본문에 장식으로 쓴
 * 이모지를 삼키면 사용자 글자가 화면에서 사라진다.
 */
export function scanTaskFields(text: string): TaskFieldSpan[] {
  const spans: TaskFieldSpan[] = [];

  for (const { emoji, kind } of CANONICAL_DATE_FIELDS) {
    let at = text.indexOf(emoji);
    while (at !== -1) {
      const after = text.slice(at + emoji.length);
      const pad = after.length - after.trimStart().length;
      const value = after.slice(pad, pad + 10);
      if (isValidDate(value)) {
        spans.push({
          emoji,
          from: at,
          kind,
          to: at + emoji.length + pad + 10,
          value,
        });
      }
      at = text.indexOf(emoji, at + emoji.length);
    }
  }

  for (const marker of Object.values(PRIORITY_EMOJI)) {
    if (!marker) continue; // "보통"은 마커가 없다
    let at = text.indexOf(marker);
    while (at !== -1) {
      spans.push({
        emoji: marker,
        from: at,
        kind: "priority",
        to: at + marker.length,
        value: marker,
      });
      at = text.indexOf(marker, at + marker.length);
    }
  }

  // §18.18 M4 시간 기록. 값은 공백을 담지 않으므로 다음 공백까지가 그 값이고, 그 값이
  // `task-timer.ts`의 문법에 맞을 때만 필드다 — 뒤에 유효한 날짜가 와야 날짜 필드인 것과
  // 같은 규칙이다. 읽지 못하는 값에 칩을 씌우면, 그 칩을 눌러 고칠 때 남의 표기를 덮는다.
  //
  // ‼️ `TIMER_EMOJI_RE`는 variation selector가 붙은 `⏱️`도 받는다. 파일에 쓰는 것은 짧은
  // 쪽뿐이지만(Rust `normalize_line`이 U+FE0F를 지운다), 다른 도구가 적어 넣은 줄은
  // 긴 쪽으로 온다.
  for (const match of text.matchAll(new RegExp(TIMER_EMOJI_RE, "g"))) {
    const at = match.index;
    const rest = text.slice(at + match[0].length);
    const value = rest.split(/\s/)[0] ?? "";
    if (parseTimer(value) === null) continue;
    spans.push({
      emoji: match[0],
      from: at,
      kind: "timer",
      to: at + match[0].length + value.length,
      value,
    });
  }

  spans.sort((a, b) => a.from - b.from);

  // §18.18 M4 반복은 **맨 뒤에서** 결정된다. 값이 자유 텍스트라 끝을 잴 규칙이 없고,
  // 남는 것이 곧 값이기 때문이다.
  //
  // ‼️ 값의 끝은 **줄 끝이 아니라 다음 필드 앞**이다. Rust `parse_task_line`이 날짜와
  // 우선순위를 **먼저** 떼어내고 남은 텍스트를 반복으로 읽으므로,
  // `🔁every week 📅2026-09-01`에서 인덱서가 보는 것은 `due=2026-09-01`과
  // `recurrence="every week"` **둘 다**다. 줄 끝까지를 반복으로 삼으면 화면에서 기한
  // 칩이 사라지고, 그 칩을 눌러 고치면 반복 규칙 한가운데를 덮어쓴다.
  //
  // 알려진 어긋남 하나: 날짜를 반복 텍스트 **안**에 적으면(`🔁 📅x every week`)
  // Rust는 날짜를 뽑아내고 `"every week"`를 반복으로 읽지만, 구간은 이어져 있어야
  // 그릴 수 있으므로 여기서는 값이 비어 칩이 서지 않는다. canonical 순서로 쓰는 한
  // 나올 수 없는 줄이고, 인덱스는 어느 쪽이든 옳다.
  const at = text.indexOf(RECURRENCE_EMOJI);
  if (at === -1) return spans;

  const stop = spans.find((span) => span.from > at)?.from ?? text.length;
  const rule = text.slice(at + RECURRENCE_EMOJI.length, stop).trim();
  // 값이 없는 맨 🔁는 필드가 아니다 — 본문에 장식으로 적은 이모지를 삼키면 안 된다는
  // 날짜 쪽 규칙과 같다. Rust도 그 줄의 `recurrence`를 `None`으로 둔다.
  if (rule === "") return spans;

  spans.push({
    emoji: RECURRENCE_EMOJI,
    from: at,
    kind: "recurrence",
    to: stop,
    value: rule,
  });
  return spans.sort((a, b) => a.from - b.from);
}

/** 달력상 실재하는 날짜인지 — Rust `is_valid_date`와 같은 기준. */
export function isValidDate(v: string): boolean {
  const m = ISO_RE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getMonth() === mo - 1 && dt.getDate() === d;
}
