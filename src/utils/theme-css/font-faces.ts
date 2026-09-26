// §351 테마 CSS 가 `@font-face` 로 선언한 서체 패밀리 — 가용성 판정의 "theme" 갈래가 읽는다
// (스펙 0060 §7.2).
//
// DOM 의 `document.fonts` 가 아니라 텍스트를 읽는 이유(2026-09-26 실측, 계획 0107 P6): 그
// 집합에는 앱 자신의 서체(번들 · KaTeX)가 섞이고, 설정 창의 이펙트가 테마를 붙이는 앱 이펙트보다
// 먼저 돌아 테마를 바꾼 직후에는 옛 `<style>` 을 읽는다.

import * as csstree from "css-tree";

/**
 * 최근에 읽은 CSS 의 결과를 몇 개까지 쥐는가. 한 테마는 모드가 둘이라 둘보다 넉넉히 잡되, 묶는
 * 이유는 키가 CSS 원문 자체라서다 — 인라인 서체(data URI)를 실은 테마 CSS 는 수 MB 이고, 묶지 않으면
 * 갈아입은 옛 테마의 CSS 가 세션 내내 남는다.
 */
const MEMO_LIMIT = 4;

/** CSS 원문 → 결과. `Map` 의 순서가 곧 최근에 쓴 순서다(가장 오래 쓰지 않은 것이 맨 앞). */
const memo = new Map<string, readonly string[]>();

/**
 * `@font-face` 안의 `font-family` 값 — 따옴표를 벗기고 앞뒤 공백을 걷은 원문. 중첩 블록(`@layer` ·
 * `@media` · `@supports` · `@container`) 안도 센다 — `font-faces.test.ts` 가 넷 다 실측한다.
 * `verify.ts`(§358)가 css-tree 3.2.1 에서 CSS 중첩 선택자 규칙 일부가 `Raw` 로 남아 그 안의
 * 선언이 워크에 닿지 않는 것을 실측한 적이 있어 여기서도 같은 위험을 확인했다 — 다만 그건
 * `&` 로 시작하지 않는 중첩 **선택자**의 문제이고, 이 넷은 정상적인 at-rule 블록이라 겪지
 * 않는다. 이 함수는 판정의 입력일 뿐 관문이 아니다 — CSS 는 이미 위생 파이프라인을 지났다.
 *
 * 같은 원문은 다시 파싱하지 않는다 — 부르는 훅(`use-theme-font-families.ts`)은 인스턴스(에디터 탭 ·
 * 서체 브라우저)마다, 마운트마다 부르고, data URI 하나를 실은 CSS 의 파싱은 1 · 4 · 8 MB 에서 약
 * 14 · 89 · 185 ms 였다(2026-09-26, Node 24 · css-tree 3.2.1, 5회 중앙값).
 * 결과는 캐시와 같은 배열이라 얼려서 돌려준다 — 부르는 쪽이 고치면 다음 호출의 답이 바뀐다.
 */
export function fontFaceFamilies(css: string): readonly string[] {
  const hit = memo.get(css);
  if (hit !== undefined) {
    memo.delete(css);
    memo.set(css, hit);
    return hit;
  }
  const families = Object.freeze(parseFontFaceFamilies(css));
  memo.set(css, families);
  if (memo.size > MEMO_LIMIT) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  return families;
}

function parseFontFaceFamilies(css: string): string[] {
  const families: string[] = [];
  csstree.walk(csstree.parse(css), {
    enter(node: csstree.CssNode) {
      if (
        node.type !== "Atrule" ||
        node.name.toLowerCase() !== "font-face" ||
        node.block === null
      ) {
        return;
      }
      csstree.walk(node.block, {
        enter(inner: csstree.CssNode) {
          if (
            inner.type !== "Declaration" ||
            inner.property.toLowerCase() !== "font-family"
          ) {
            return;
          }
          const name = unquote(csstree.generate(inner.value).trim());
          if (name !== "") families.push(name);
        },
      });
    },
  });
  return families;
}

function unquote(value: string): string {
  const first = value[0];
  return (first === '"' || first === "'") &&
    value.length >= 2 &&
    value.endsWith(first)
    ? value.slice(1, -1).trim()
    : value;
}
