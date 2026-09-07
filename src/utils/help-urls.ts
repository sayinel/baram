// §4.2 Help 문서는 앱에 번들되지 않고 홈페이지에서 서빙된다.
// 설계: dev/design/specs/2026-09-06-docs-site-i18n-restructure-design.md
//
// ‼️ 아래 slug 는 사이트의 `site/help-routes.json` 과 짝이다. 한쪽만 바꾸면 앱이 404를
// 연다 — `__tests__/help-urls.test.ts` 가 그 JSON 에서 기대값을 **파생시켜** 고정한다.
// 앱이 `site/` 를 직접 import 하지는 않는다: 사이트는 자체 package.json 을 가진 독립
// 프로젝트이고, 그 경계를 코드가 넘으면 앱 빌드가 사이트 구조에 묶인다.
import type { Locale } from "../i18n";

/** 홈페이지 루트. 끝의 `/`는 문서 URL 조립에 쓰이므로 유지한다. */
export const BARAM_HOMEPAGE = "https://baram.ing/";

export type HelpDoc = "faq" | "guide" | "shortcuts";

/** 문서 URL 의 로케일 뒤에 붙는 세그먼트. 랜딩이 `/<locale>/` 를 쓰므로 문서는 한 단 아래다. */
const DOCS_PREFIX = "docs/";

/** Help 메뉴 세 항목이 착지하는 페이지 slug (IA 트리의 slug 와 같아야 한다). */
const DOC_SLUGS: Record<HelpDoc, string> = {
  faq: "faq/general",
  guide: "getting-started",
  shortcuts: "customization/keyboard-shortcuts",
};

/**
 * 그 로케일의 문서 URL.
 *
 * Starlight 의 폴백이 미번역 페이지도 항상 렌더하므로 `ko` 가 404 가 될 수 없다 —
 * 번역이 없으면 영문 본문과 번역 알림이 나온다.
 */
export function helpDocUrl(doc: HelpDoc, locale: Locale): string {
  return `${BARAM_HOMEPAGE}${locale}/${DOCS_PREFIX}${DOC_SLUGS[doc]}/`;
}
