// §4.2 Help 문서는 앱에 번들되지 않고 홈페이지에서 서빙된다.
// 설계: dev/design/specs/2026-09-06-online-help-docs-design.md
//
// ‼️ 아래 파일명은 `site/build-docs.mjs`의 DOCS[].out과 짝이다. 한쪽만 바꾸면
// 앱이 404를 연다 — `__tests__/help-urls.test.ts`가 그 짝을 고정한다.

/** GitHub Pages 홈페이지 루트. 끝의 `/`는 문서 URL 조립에 쓰이므로 유지한다. */
export const BARAM_HOMEPAGE = "https://sayinel.github.io/baram/";

export const HELP_DOC_URLS = {
  guide: `${BARAM_HOMEPAGE}docs/user-guide.html`,
  shortcuts: `${BARAM_HOMEPAGE}docs/keyboard-shortcuts.html`,
  faq: `${BARAM_HOMEPAGE}docs/faq.html`,
} as const;
