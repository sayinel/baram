// §303 태스크 줄에서 필드 하나를 **넣고·고치고·지우는** 한 자.
//
// M3-a(칩 클릭)는 이미 있는 값을 갈아끼우기만 했다. M3-b(`/due`·`/priority`)는 처음으로
// **없던 필드를 더한다** — 그 순간 "어디에 놓는가"라는 질문이 생기고, 그 질문에는 이미
// 답이 있다: Rust `src-tauri/src/task/fields.rs`의 `insert_field`다. 정리 메뉴·체크박스
// 같은 디스크 경로가 전부 그것을 지나가므로, 에디터가 다른 규칙으로 넣으면 **같은 조작이
// 어느 표면에서 했느냐에 따라 다른 줄을 만든다.** 그래서 여기 다시 적는 것은 새 규칙이
// 아니라 그 함수의 이식이고, 아래 테스트는 `fields.rs`의 케이스를 **같은 문자열로** 든다
// (`task-field-order.ts` ↔ `fields.rs`가 이미 쓰는 방식이다 — 한쪽을 고치면 다른 쪽이
// 빨간불이 된다).
//
// ‼️ Rust와 입력의 모양이 하나 다르다. 저쪽은 `- [ ] ` 접두가 붙은 **줄 전체**를 받고,
// 여기 오는 것은 그 접두를 뗀 **문단 텍스트**다(ProseMirror에서 체크박스는 속성이라
// 텍스트에 없다). 그래서 필드 뭉치 앞에 공백이 반드시 있다는 Rust의 전제가 여기서는
// 깨진다 — 줄이 통째로 필드일 수 있다. `fieldRunStart`가 0을 후보로 더 세는 이유다.

import type { TaskFieldKind } from "./task-field-order";
import type { TaskFieldSpan } from "./task-field-scan";

import {
  CANONICAL_DATE_FIELDS,
  fieldRank,
  PRIORITY_MARKERS,
  PRIORITY_RANK,
  RECURRENCE_EMOJI,
  RECURRENCE_RANK,
} from "./task-field-order";
import { isValidDate, scanTaskFields } from "./task-field-scan";

/** 텍스트 편집 하나. `insert`가 빈 문자열이면 제거다. */
export interface TextEdit {
  /** 편집이 시작하는 UTF-16 오프셋. */
  at: number;
  insert: string;
  /** `at`부터 지울 길이. 0이면 순수 삽입이다. */
  remove: number;
}

/**
 * 필드 하나를 반영한 새 문단 텍스트.
 *
 * `value`는 그 필드의 **자기 어휘**다 — 날짜 필드는 ISO 날짜, 우선순위는 마커 자체
 * (`TaskFieldSpan.value`와 같은 규약). 빈 문자열은 "이 필드를 지운다"는 뜻이고,
 * 우선순위의 "보통"은 마커가 없으므로 그것과 같은 말이 된다.
 *
 * `span`을 주면 **그 구간**을 고친다(칩 클릭 — 한 줄에 같은 종류가 둘일 수 있다).
 * 주지 않으면 그 종류의 **첫 구간**을 고친다. 첫 구간인 것은 Rust 파서가 같은 필드가
 * 두 번 있을 때 처음 것을 읽기 때문이다(`readTaskLine`과 같은 규칙).
 */
export function applyTaskField(
  body: string,
  kind: TaskFieldKind,
  value: string,
  span?: TaskFieldSpan,
): string {
  const target = span ?? scanTaskFields(body).find((s) => s.kind === kind);

  if (value === "") {
    return target ? cutSpan(body, target.from, target.to) : body;
  }

  const token = kind === "priority" ? value : `${emojiFor(kind)}${value}`;
  if (target) {
    return body.slice(0, target.from) + token + body.slice(target.to);
  }
  return insertToken(body, token);
}

/**
 * 두 문자열의 차이를 **편집 하나**로. 같으면 `null`.
 *
 * 이 한 겹이 있는 이유: 위 함수는 Rust와 같은 규칙으로 **줄 전체**를 계산하는데,
 * ProseMirror에 그 줄을 통째로 다시 쓰면 문단 안의 링크·위키링크·수식·굵은 글씨가
 * 평문으로 무너진다. 그래서 계산은 문자열로 하고, 문서에는 **바뀐 자리만** 닿는다.
 *
 * 코드 유닛으로 세므로 공통 접두가 이모지의 서러게이트 쌍 가운데에 떨어질 수 있다
 * (📅=D83D DCC5와 📈=D83D DCC8은 앞 유닛이 같다). **그래도 결과는 옳다**: 편집은
 * 정의상 `접두 + 새 가운데 + 접미`이고 갈라진 짝은 양쪽에 같은 유닛으로 남아 다시
 * 붙는다. 쌍을 피하는 가드를 한 번 넣었다가 뺐다 — 그것이 막는 오류가 없었다.
 */
export function minimalEdit(before: string, after: string): null | TextEdit {
  if (before === after) return null;

  const max = Math.min(before.length, after.length);
  let head = 0;
  while (head < max && before[head] === after[head]) head += 1;

  let tail = 0;
  while (
    tail < max - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }

  return {
    at: head,
    insert: after.slice(head, after.length - tail),
    remove: before.length - head - tail,
  };
}

/** 구간을 지우면서 **구분 공백 하나**를 함께 가져간다 — 남기면 `할 일  ⏫`이 된다. */
function cutSpan(body: string, from: number, to: number): string {
  let start = from;
  let end = to;
  if (start > 0 && WS_RE.test(body[start - 1])) start -= 1;
  // 필드가 줄 맨 앞이면 앞에 가져올 공백이 없다 — 뒤엣것을 가져온다.
  else if (end < body.length && WS_RE.test(body[end])) end += 1;
  return body.slice(0, start) + body.slice(end);
}

/** 날짜 필드의 이모지. 우선순위는 마커가 곧 값이라 여기 오지 않는다. */
function emojiFor(kind: TaskFieldKind): string {
  return CANONICAL_DATE_FIELDS.find((f) => f.kind === kind)?.emoji ?? "";
}

/**
 * 토큰이 **여기서 시작하는가** — 그 길이와 canonical 순위. Rust `field_token`의 이식.
 *
 * 날짜 이모지는 뒤에 유효한 날짜가 와야 필드다. 본문에 장식으로 적은 📅를 필드로 세면
 * 새 필드가 그 앞으로 들어가 사용자 문장을 가른다.
 *
 * 반복(🔁)의 값은 자유 텍스트라 **줄 끝까지**가 그 값이다. 끝을 잴 수 없어도 경계로
 * 쓰는 데는 문제가 없다 — 여기부터 끝까지가 통째로 반복 필드다.
 */
function fieldTokenAt(s: string): null | { length: number; rank: number } {
  for (const marker of PRIORITY_MARKERS) {
    if (s.startsWith(marker)) {
      return { length: marker.length, rank: PRIORITY_RANK };
    }
  }
  if (s.startsWith(RECURRENCE_EMOJI)) {
    return { length: s.length, rank: RECURRENCE_RANK };
  }
  for (const [rank, { emoji }] of CANONICAL_DATE_FIELDS.entries()) {
    if (!s.startsWith(emoji)) continue;
    const after = s.slice(emoji.length);
    // 이모지와 값 사이의 공백을 허용한다 — Obsidian Tasks가 `📅 2026-08-30`으로 쓴다.
    const pad = after.length - after.trimStart().length;
    const value = after.slice(pad, pad + 10);
    if (isValidDate(value)) {
      return { length: emoji.length + pad + value.length, rank };
    }
  }
  return null;
}

/**
 * 줄 끝의 **필드 뭉치가 시작하는** 자리. 필드가 없으면 줄 끝.
 *
 * "첫 이모지 앞"이 아니라 "거기서 끝까지가 전부 필드인 가장 이른 자리"다. 그래야 본문에
 * 장식용 이모지가 섞인 줄에서도 새 필드가 본문을 가르지 않는다.
 *
 * 구분자는 ASCII 공백만이 아니라 모든 공백이다 — 탭으로 구분된 줄도 파서는 정상
 * 태스크로 읽으므로, 여기서만 어휘가 좁으면 그런 줄에서 자리를 못 찾는다.
 */
function fieldRunStart(trimmed: string): number {
  // ‼️ Rust에 없는 후보. 저쪽 입력에는 `- [ ] ` 접두가 있어 뭉치 앞에 공백이 반드시
  // 있지만, 여기 오는 문단 텍스트는 줄이 통째로 필드일 수 있다.
  if (trimmed !== "" && isAllFields(trimmed)) return 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (!WS_RE.test(trimmed[i])) continue;
    const start = i + 1;
    if (start < trimmed.length && isAllFields(trimmed.slice(start))) {
      return start;
    }
  }
  return trimmed.length;
}

/**
 * §303 자리에 토큰을 끼운 줄. Rust `insert_field`의 이식.
 *
 * ‼️ 기존 필드를 **재배열하지 않는다.** 사용자가 손으로 적은 비정규 순서까지 조용히
 * 뒤집으면, 날짜 하나를 준 것뿐인데 줄 전체의 바이트가 예고 없이 바뀐다.
 */
function insertToken(body: string, token: string): string {
  const trimmed = body.replace(TRAILING_WS_RE, "");
  const at = insertionPoint(trimmed, fieldRank(token));
  const head = trimmed.slice(0, at).replace(TRAILING_WS_RE, "");
  // `tail`은 앞 공백을 털지 않는다 — `insertionPoint`가 구분자를 이미 지난 자리를
  // 주기 때문이다. Rust에는 `trim_start`가 있지만 같은 이유로 그쪽에서도 닿지 않는다.
  const tail = trimmed.slice(at);
  return [head, token, tail].filter(Boolean).join(" ");
}

/**
 * 순위 `rank`의 필드를 끼울 자리 — 필드 뭉치 안에서 **처음으로 순위가 더 큰** 토큰
 * 바로 앞. 없으면 줄 끝. Rust `insertion_point`의 이식.
 *
 * 돌려주는 자리는 **구분 공백을 이미 지난** 곳이다(토큰의 첫 글자, 또는 줄 끝).
 * `insertToken`이 그 뒤를 앞 공백 없는 조각으로 다루는 근거가 이것이다.
 *
 * 순위가 **같은** 토큰은 지나친다(`>`이지 `>=`가 아니다). 실제로 같은 순위를 만날 일은
 * 없다 — 그 종류가 이미 있으면 `applyTaskField`가 삽입이 아니라 교체를 고르기 때문이다.
 */
function insertionPoint(trimmed: string, rank: number): number {
  let at = fieldRunStart(trimmed);
  while (at < trimmed.length) {
    const rest = trimmed.slice(at);
    // 뭉치의 첫 토큰은 `fieldRunStart`가 이미 공백을 지나 가리키므로 pad가 0이고,
    // 두 번째부터는 앞 토큰과의 구분 공백만큼 pad가 생긴다.
    const pad = rest.length - rest.trimStart().length;
    const tokenStart = at + pad;
    const token = fieldTokenAt(trimmed.slice(tokenStart));
    // `fieldRunStart`가 "여기부터 전부 필드"임을 보장하므로 도달하지 않는다.
    if (!token) break;
    if (token.rank > rank) return tokenStart;
    at = tokenStart + token.length;
  }
  return trimmed.length;
}

function isAllFields(s: string): boolean {
  let rest = s.trim();
  while (rest !== "") {
    const token = fieldTokenAt(rest);
    if (!token) return false;
    rest = rest.slice(token.length).trimStart();
  }
  return true;
}

const TRAILING_WS_RE = /\s+$/;
const WS_RE = /\s/;
