// §351 테마 CSS 가 `@font-face` 로 선언한 서체 패밀리 — 가용성 판정의 "theme" 갈래가 읽는다
// (스펙 0060 §7.2).
//
// DOM 의 `document.fonts` 가 아니라 텍스트를 읽는 이유(2026-09-26 실측, 계획 0107 P6): 그
// 집합에는 앱 자신의 서체(번들 · KaTeX)가 섞이고, 설정 창의 이펙트가 테마를 붙이는 앱 이펙트보다
// 먼저 돌아 테마를 바꾼 직후에는 옛 `<style>` 을 읽는다.

import * as csstree from "css-tree";

/**
 * `@font-face` 안의 `font-family` 값 — 따옴표를 벗기고 앞뒤 공백을 걷은 원문. 중첩 블록(`@layer` ·
 * `@media` · `@supports` · `@container`) 안도 센다 — `font-faces.test.ts` 가 넷 다 실측한다.
 * `verify.ts`(§358)가 css-tree 3.2.1 에서 CSS 중첩 선택자 규칙 일부가 `Raw` 로 남아 그 안의
 * 선언이 워크에 닿지 않는 것을 실측한 적이 있어 여기서도 같은 위험을 확인했다 — 다만 그건
 * `&` 로 시작하지 않는 중첩 **선택자**의 문제이고, 이 넷은 정상적인 at-rule 블록이라 겪지
 * 않는다. 이 함수는 판정의 입력일 뿐 관문이 아니다 — CSS 는 이미 위생 파이프라인을 지났다.
 */
export function fontFaceFamilies(css: string): string[] {
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
