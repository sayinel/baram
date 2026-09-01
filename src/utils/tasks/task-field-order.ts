// §303 canonical 필드 순서 — 프런트가 태스크 줄을 **지을 때** 쓰는 표.
//
// Rust `src-tauri/src/task/fields.rs`의 `FIELD_EMOJI`·`PRIORITY_RANK`·`RECURRENCE_RANK`와
// 같은 표다. 언어가 달라 한 벌로 만들 수 없으므로 양쪽에 같은 표를 두고, 양쪽 테스트가
// 같은 줄을 단정한다(`task-field-order.test.ts` ↔ `fields.rs`의
// `canonical_field_order_is_the_section_303_table`) — 어느 쪽을 고쳐도 다른 쪽이 빨간불이 된다.
//
// ‼️ 왜 프런트에도 필요한가: 이미 있는 줄을 **고치는** 일은 전부 Rust가 한다(`insert_field`).
// 그러나 캡처는 줄을 **처음 짓는다** — 그 순간 Rust는 관여하지 않으므로 순서를 아는 곳이
// 여기밖에 없다. M2-b1이 이 표 없이 지어서 `⏫`를 맨 앞에, `➕`를 맨 뒤에 두었다.

import { TIMER_EMOJI_RE } from "./task-timer";

/** 이모지 필드의 종류. §303 표에 있는 것 전부. */
export type TaskFieldKind =
  | "cancelled"
  | "created"
  | "done"
  | "due"
  | "priority"
  // §18.18 M4. 값이 자유 텍스트("every week")라 날짜 여섯과 나란히 설 수 없어
  // `CANONICAL_DATE_FIELDS`에는 들어가지 않지만, **고칠 수 있는 필드**라는 점에서는
  // 같다 — 칩을 누르면 열리고, 지우면 사라진다.
  | "recurrence"
  | "scheduled"
  | "start"
  // §18.18 M4 시간 기록. 값 문법과 상태 연동은 `task-timer.ts`에 있다.
  | "timer";

/**
 * §18.2 표 순서 그대로의 날짜 필드. **배열 인덱스가 곧 canonical 순위**이므로
 * 순서를 바꾸면 파일에 쓰이는 순서가 바뀐다 — 필드를 더할 때는 표를 먼저 고칠 것.
 */
export const CANONICAL_DATE_FIELDS: readonly {
  emoji: string;
  kind: Exclude<TaskFieldKind, "priority">;
}[] = [
  { emoji: "➕", kind: "created" },
  { emoji: "🛫", kind: "start" },
  { emoji: "⏳", kind: "scheduled" },
  { emoji: "📅", kind: "due" },
  { emoji: "✅", kind: "done" },
  { emoji: "❌", kind: "cancelled" },
];

/**
 * 우선순위는 날짜 여섯 뒤. `CANONICAL_DATE_FIELDS.length`로 쓰지 않고 상수로 둔 것은
 * 이 값이 **배열 길이가 아니라 §18.2 표에서의 자리**라는 뜻이기 때문이다.
 */
export const PRIORITY_RANK = 6;

/** 시간 기록은 우선순위 뒤, 반복 앞. */
export const TIMER_RANK = 7;

/**
 * 반복은 마지막 — 값이 줄 끝까지라 뒤에 아무것도 놓을 수 없기도 하다.
 *
 * ‼️ M4에서 7 → 8이 됐다(`⏱`가 사이에 들어왔다). Rust `fields.rs`의 같은 상수와
 * 함께 움직여야 한다 — 두 쪽이 다른 숫자를 들면 같은 조작이 표면에 따라 다른 줄을 만든다.
 */
export const RECURRENCE_RANK = 8;

/** 반복 규칙 이모지. Rust `parse.rs`의 `RECURRENCE_EMOJI`와 같은 글자. */
export const RECURRENCE_EMOJI = "🔁";

/**
 * 토큰 하나의 canonical 순위.
 *
 * 우리가 짓지 않는 토큰은 순서를 **주장하지 않는다** — 맨 뒤로 보낸다. 앞으로 보내면
 * 모르는 글자가 사용자 본문과 필드 사이를 비집고 들어간다.
 */
export function fieldRank(token: string): number {
  const i = CANONICAL_DATE_FIELDS.findIndex((f) => token.startsWith(f.emoji));
  if (i !== -1) return i;
  if (PRIORITY_MARKERS.some((m) => token.startsWith(m))) return PRIORITY_RANK;
  if (TIMER_EMOJI_RE.test(token.slice(0, 2))) return TIMER_RANK;
  if (token.startsWith(RECURRENCE_EMOJI)) return RECURRENCE_RANK;
  return RECURRENCE_RANK + 1;
}

/**
 * 필드 토큰들을 §303 순서로. 순위가 같으면 들어온 순서를 지킨다 — 엔진의 정렬
 * 안정성에 기대지 않고 원래 인덱스를 명시적 타이브레이커로 쓴다.
 */
export function orderFields(tokens: string[]): string[] {
  return tokens
    .map((token, index) => ({ index, rank: fieldRank(token), token }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.token);
}

/**
 * 우선순위 **가중치** → 마커. Rust `parse.rs`의 `PRIORITY_MARKERS`와 같은 눈금이다:
 * 🔺=+2 · ⏫=+1 · (없음)=0 · 🔽=−1 · ⏬=−2.
 *
 * ‼️ 입력 트리거의 `prio:1..5`와 **다른 축이다.** 저쪽은 P1~P5 관례를 따르는 순번이고
 * (`PRIORITY_EMOJI`), 이쪽은 `TaskEntry.priority`가 실제로 들고 다니는 부호 있는
 * 가중치다. 필터(`priority >= 1`)와 배지가 이 축을 본다. 둘을 섞으면 `prio:4`(낮음)가
 * 가중치 4로 읽혀 "가장 높음"보다 위에 서게 된다.
 */
export const PRIORITY_MARKER_BY_WEIGHT: Record<number, string> = {
  "-1": "🔽",
  "-2": "⏬",
  1: "⏫",
  2: "🔺",
};

/** 마커 → 가중치. 위 표의 역방향이며, 표가 유일한 출처다. */
export const PRIORITY_WEIGHT_BY_MARKER: Record<string, number> =
  Object.fromEntries(
    Object.entries(PRIORITY_MARKER_BY_WEIGHT).map(([w, m]) => [m, Number(w)]),
  );

/** 마커 글자만. `fieldRank`와 토큰 스캐너가 "이것이 우선순위인가"를 물을 때 쓴다. */
export const PRIORITY_MARKERS = Object.values(PRIORITY_MARKER_BY_WEIGHT);
