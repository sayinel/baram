// src/utils/editor/quote-font-family.ts
// §349 사용자 서체 이름 → CSS <family-name>.
//
// 인용하지 않은 <family-name>은 <custom-ident> 열이고, custom-ident 는 숫자로
// 시작할 수 없다. 설정 목록에 실제로 있던 "Source Sans 3"이 그 경우이고,
// 공백·콤마·따옴표가 든 이름도 같은 부류다. 전부 인용으로 사라진다.

/**
 * 인용하면 무효해지는 키워드들.
 *
 * `"serif"`는 패밀리 이름 serif 를 찾으라는 뜻이 되어 제네릭 폴백이 죽는다.
 * 그래서 열거된 예외로 통과시킨다 — 열거이므로 CSS가 제네릭을 더하면 여기도
 * 늘려야 한다.
 */
const GENERIC_FAMILIES = new Set([
  "cursive",
  "emoji",
  "fangsong",
  "fantasy",
  "math",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-rounded",
  "ui-sans-serif",
  "ui-serif",
]);

/**
 * 서체 이름을 CSS 값으로 안전하게 만든다.
 *
 * 빈 문자열은 그대로 돌려준다 — 호출자가 "설정 없음"으로 읽고 토큰 스택에
 * 그대로 떨어지게 하기 위해서다.
 */
export function quoteFamily(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return "";
  if (GENERIC_FAMILIES.has(trimmed.toLowerCase())) return trimmed;
  const escaped = trimmed.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
  return `"${escaped}"`;
}
