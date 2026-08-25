// §308 표시 절반 — 한 줄에서 이모지 필드의 **구간**을 찾는다.
//
// 문서 모델을 바꾸지 않는다. 이 구간을 데코레이션이 숨기고 그 자리에 칩을 그린다.
// 어휘(트리거·이모지)는 `task-field-tokens.ts`가 유일한 출처다 — 여기서 재정의하면
// 에디터 입력 규칙·캡처·표시가 서로 다른 어휘를 갖게 된다.

import { DATE_FIELDS, PRIORITY_EMOJI } from "./task-field-tokens";

export type TaskFieldKind =
  "cancelled" | "created" | "done" | "due" | "priority" | "scheduled" | "start";

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

/** `task-field-tokens.ts`가 다루지 않는 읽기 전용 필드까지 포함한 전체 표. */
const DATE_EMOJI: { emoji: string; kind: TaskFieldKind }[] = [
  ...DATE_FIELDS.map((f) => ({
    emoji: f.emoji,
    kind:
      f.trigger === "sched"
        ? ("scheduled" as const)
        : (f.trigger as TaskFieldKind),
  })),
  { emoji: "➕", kind: "created" },
  { emoji: "✅", kind: "done" },
  { emoji: "❌", kind: "cancelled" },
];

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `text`에서 이모지 필드 구간을 등장 순서로 찾는다.
 *
 * 유효한 값이 뒤따르지 않는 이모지는 **구간이 아니다** — 본문에 장식으로 쓴
 * 이모지를 삼키면 사용자 글자가 화면에서 사라진다.
 */
export function scanTaskFields(text: string): TaskFieldSpan[] {
  const spans: TaskFieldSpan[] = [];

  for (const { emoji, kind } of DATE_EMOJI) {
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

  return spans.sort((a, b) => a.from - b.from);
}

/** 달력상 실재하는 날짜인지 — Rust `is_valid_date`와 같은 기준. */
function isValidDate(v: string): boolean {
  const m = ISO_RE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getMonth() === mo - 1 && dt.getDate() === d;
}
