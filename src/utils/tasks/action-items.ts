// §314 AI가 낸 액션 아이템을 이 앱의 태스크 줄로 다듬는다.
//
// ‼️ **날짜를 모델에게 맡기지 않는다.** 프롬프트가 `📅2026-09-17`을 요구하려면 모델이
// 오늘이 며칠인지 알고 날짜 산술을 해야 하는데, 그것이 언어 모델이 가장 자주 틀리는
// 종류의 일이다. 대신 모델에게는 **원문의 표현을 그대로 두라**고 시키고, `내일`·`금요일까지`
// 를 날짜로 바꾸는 것은 에디터가 쓰는 그 파서(`natural-date.ts`)가 한다. 결정적이고,
// 테스트할 수 있고, 무엇보다 "AI가 뽑은 마감"과 "손으로 적은 마감"이 같은 규칙을 지난다.
//
// 다듬기는 **버리는 쪽으로** 기운다. 모델은 머리말("다음은 액션 아이템입니다:")·맺음말·
// 번호·굵은 글씨를 즐겨 붙이는데, 그것들이 그대로 문서에 들어가면 사용자는 자기가 쓰지
// 않은 문장을 회의록에서 보게 된다. 목록 항목처럼 생긴 줄만 남긴다.

import { guessTrailingDate } from "./natural-date";
import { applyTaskField } from "./task-field-splice";

/**
 * 추출 프롬프트. 출력 형식을 좁게 못 박는 것이 요점이다 — 넓게 두면 모델이 설명을 붙이고,
 * 그 설명이 곧 문서에 들어갈 문장이 된다.
 *
 * 담당자를 필드로 만들지 않는다(§18.17). 이름은 본문에 그대로 남긴다.
 */
export const ACTION_ITEM_SYSTEM_PROMPT = [
  "Extract action items from the text as a markdown task list.",
  "Output ONLY lines of the form `- [ ] <task>`. No heading, no preamble, no closing remark, no numbering, no bold.",
  "Keep each task on one line, in the language of the source text.",
  "‼️ Leave any date expression exactly as it appears in the source (tomorrow, Friday, 금요일까지). Do NOT convert it to a calendar date — the editor does that.",
  "Keep a person's name in the task text itself; there is no assignee field.",
  "If the text contains no action item, output nothing at all.",
].join("\n");

/**
 * 모델의 출력을 태스크 줄들로. 남는 것이 없으면 빈 문자열.
 *
 * 날짜 표현은 잘라내고 §303 자리의 `📅` 필드가 된다 — 잘라내는 이유는 `내일`이 문서에
 * 남으면 하루 뒤에 그 줄이 거짓말을 하기 때문이다. 절대 날짜가 된 것만 남는다.
 */
export function normalizeActionItems(raw: string, today: Date): string {
  const lines: string[] = [];

  for (const line of raw.split("\n")) {
    const m = LIST_ITEM_RE.exec(line);
    if (!m) continue;

    const body = stripEmphasis(m[2].trim());
    if (body === "") continue;

    lines.push(`${m[1]}- [ ] ${withDueDate(body, today)}`);
  }

  return lines.join("\n");
}

/**
 * 목록 항목의 껍데기. 앞 들여쓰기(1)와 알맹이(2)를 가른다.
 *
 * 체크박스·불릿·번호를 모두 받는다. 프롬프트가 체크박스를 요구하지만 모델은 자주
 * 어기고, 그때 결과가 통째로 비면 사용자에게는 "아무것도 못 찾았다"로 보인다 —
 * 형식을 어긴 것과 찾은 것이 없는 것은 다른 사실이다.
 */
const LIST_ITEM_RE = /^(\s*)(?:[-*+]\s*(?:\[[ xX/-]\]\s*)?|\d+[.)]\s+)(.*)$/;

/** 모델이 즐겨 붙이는 `**굵게**`·`__밑줄__` 껍데기를 벗긴다. */
function stripEmphasis(body: string): string {
  return body.replace(/^\*\*(.*)\*\*$/s, "$1").replace(/^__(.*)__$/s, "$1");
}

/** 본문 끝의 날짜 표현을 `📅` 필드로 옮긴다. 없으면 본문 그대로. */
function withDueDate(body: string, today: Date): string {
  const guess = guessTrailingDate(body, body.length, today);
  if (!guess) return body;

  // 표현 앞의 구분 공백까지 가져간다 — 남기면 `보고서  📅2026-09-17`이 된다.
  const cut = guess.from > 0 && /\s/.test(body[guess.from - 1]) ? 1 : 0;
  const rest = body.slice(0, guess.from - cut) + body.slice(guess.to);
  return applyTaskField(rest, "due", guess.iso);
}
