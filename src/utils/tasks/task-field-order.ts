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

/** 이모지 필드의 종류. §303 표에 있는 것 전부. */
export type TaskFieldKind =
  "cancelled" | "created" | "done" | "due" | "priority" | "scheduled" | "start";

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

/** 반복은 마지막 — 값이 줄 끝까지라 뒤에 아무것도 놓을 수 없기도 하다. */
export const RECURRENCE_RANK = 7;

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
 * 마커가 있는 우선순위 네 개. "보통"(0)은 마커 자체가 없으므로 여기 없다 —
 * Rust `parse.rs`의 `PRIORITY_MARKERS`와 같은 집합이다.
 */
const PRIORITY_MARKERS = ["🔺", "⏫", "🔽", "⏬"];
