// M2-b4 태스크 편집 모달의 읽기·쓰기 — 한 줄 ↔ 폼 값.
//
// 어휘를 새로 만들지 않는다. 이모지와 순서는 `task-field-order.ts`, 구간 찾기는
// `task-field-scan.ts`가 유일한 출처다. 여기서 다시 적으면 같은 줄을 모달과 칩이
// 다르게 읽는 순간이 오고, 사용자는 어느 쪽을 믿을지 알 수 없다.
//
// ‼️ 최우선 기준은 **라운드트립**이다. 폼을 열었다 아무것도 고치지 않고 저장했을 때
// 줄이 한 글자도 달라지지 않아야 한다. 그렇지 않으면 이 모달은 "열어 보기만 해도
// 문서가 바뀌는" 도구가 되고, 그건 미리보기로도 가려지지 않는다(사용자는 바뀐 줄을
// 자기가 바꾼 것으로 읽는다).

import type { TaskFieldKind } from "./task-field-order";

import {
  CANONICAL_DATE_FIELDS,
  orderFields,
  PRIORITY_MARKER_BY_WEIGHT,
  PRIORITY_WEIGHT_BY_MARKER,
} from "./task-field-order";
import { scanTaskFields } from "./task-field-scan";

/** 폼이 들고 있는 값. 없는 필드는 빈 문자열이다 — `null`과 구분할 이유가 없다. */
export type DateKind = Exclude<TaskFieldKind, "priority">;

export interface TaskLineDraft {
  /** 이모지 필드와 태그를 뺀 본문. 위키링크·블록참조는 여기 남는다 */
  body: string;
  /** kind → ISO 날짜. 빈 값은 "필드 없음" */
  dates: Partial<Record<DateKind, string>>;
  /**
   * 부호 있는 **가중치**: 🔺=+2 · ⏫=+1 · 없음=0 · 🔽=−1 · ⏬=−2.
   * `TaskEntry.priority`와 같은 축이다 — 입력 트리거의 `prio:1..5`와 혼동하지 말 것.
   */
  priority: number;
  /** 우리가 순서를 주장하지 않는 토큰 — 있는 그대로 맨 뒤에 되붙인다 */
  rest: string[];
  /** `#` 없는 이름 */
  tags: string[];
}

/**
 * 태스크 줄의 **본문 부분**(`- [ ] ` 접두를 뺀 나머지)을 폼 값으로 읽는다.
 *
 * 체크박스 마커는 다루지 않는다 — 상태 전이는 `setTaskState`가 이미 갖고 있고,
 * 두 곳이 마커를 쓰면 완료일(`✅`) 규칙이 갈라진다.
 */
export function readTaskLine(text: string): TaskLineDraft {
  const spans = scanTaskFields(text);
  const dates: Partial<Record<DateKind, string>> = {};
  let priority = 0;

  for (const span of spans) {
    if (span.kind === "priority") {
      priority = PRIORITY_WEIGHT_BY_MARKER[span.value] ?? 0;
    } else {
      // 같은 필드가 두 번 있으면 **처음 것**을 쓴다 — Rust 파서와 같은 규칙이다.
      dates[span.kind] ??= span.value;
    }
  }

  // 구간을 뒤에서부터 지운다. 앞에서 지우면 남은 구간의 인덱스가 밀린다.
  let remaining = text;
  for (const span of [...spans].reverse()) {
    remaining = remaining.slice(0, span.from) + remaining.slice(span.to);
  }

  const tags: string[] = [];
  const rest: string[] = [];
  const bodyWords: string[] = [];
  for (const word of remaining.split(/\s+/)) {
    if (!word) continue;
    if (TAG_RE.test(word)) tags.push(word.slice(1));
    else if (UNKNOWN_FIELD_RE.test(word)) rest.push(word);
    else bodyWords.push(word);
  }

  return { body: bodyWords.join(" "), dates, priority, rest, tags };
}

/**
 * 폼 값을 다시 한 줄로. §303 순서(`➕ 🛫 ⏳ 📅 ✅ ❌` → 우선순위 → 반복)를 따른다.
 *
 * 태그는 이모지 필드 **앞**이다 — 캡처(`task-capture.ts`)와 같은 자리이고, 파서가
 * 태그를 본문의 일부로 읽기 때문이다.
 */
export function writeTaskLine(draft: TaskLineDraft): string {
  const fields: string[] = [];
  for (const { emoji, kind } of CANONICAL_DATE_FIELDS) {
    const value = draft.dates[kind as DateKind];
    if (value) fields.push(`${emoji}${value}`);
  }
  const marker = PRIORITY_MARKER_BY_WEIGHT[draft.priority];
  if (marker) fields.push(marker);

  const parts = [
    draft.body.trim(),
    ...draft.tags.map((t) => `#${t.replace(/^#+/, "")}`),
    ...orderFields([...fields, ...draft.rest]),
  ];
  return parts.filter(Boolean).join(" ");
}

/** `#태그` — 한글·숫자·`/`·`-`·`_`를 포함한다(Rust `parse.rs`의 태그 규칙과 같다). */
const TAG_RE = /^#[^\s#]+$/u;

/**
 * 우리가 순서를 주장하지 않는 토큰 — 반복(`🔁`)처럼 값이 붙는 이모지 필드나, 앞으로
 * 생길 표기. `orderFields`가 맨 뒤로 보내므로 자리만 지켜 주면 된다.
 *
 * 본문 단어와 구별해야 하는 이유: 본문에 섞어 두면 저장할 때 본문 중간으로 들어가고,
 * 다시 읽을 때 또 옮겨져 줄이 매번 달라진다.
 */
const UNKNOWN_FIELD_RE = /^(?:🔁)/u;
