// §275.3 블록 참조 display 문자열 생성.
//
// BLOCK_REF_RE(pipeline/block-id.ts:42)의 display 캡처는 `([^)]+)`라서 `)`를
// 담을 수 없는데, 논문 텍스트에는 흔하다("as shown in (Fig. 3)"). 대괄호는
// 짝이 맞으면 `[[x]]` wikilink 패턴으로 오인될 수 있고, `|`는 캡처를 끊는다.
//
// display는 표시용 라벨이므로 이 손실은 허용된다 — 원문은 동반 노트에 온전히
// 보존되고, 선택 팝업의 "Copy text"가 무손실 경로를 제공한다.

export const MAX_DISPLAY_LEN = 80;

/** 하이라이트 텍스트를 블록 참조 display로 안전하게 변환한다. */
export function buildRefDisplay(text: string): string {
  const stripped = text
    .replace(/[()[\]|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (stripped.length <= MAX_DISPLAY_LEN) return stripped;
  return `${stripped.slice(0, MAX_DISPLAY_LEN).trimEnd()}…`;
}
