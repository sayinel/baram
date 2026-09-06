// §4.2 앱이 여는 Help URL ↔ 사이트가 생성하는 문서 페이지의 짝.
//
// ‼️ 기대값을 앱 쪽에 리터럴로 복제하면 사이트 파일명이 바뀔 때 앱만 404가 된다.
// 그래서 `site/build-docs.mjs`의 DOCS에서 파생시킨다. 스캔이 빈손이면 어떤 단정도
// 공허해지므로, 먼저 스캔 결과 자체를 고정한다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BARAM_HOMEPAGE, HELP_DOC_URLS } from "../help-urls";

/** `site/build-docs.mjs`의 DOCS 배열이 생성하는 out 파일명들. */
function siteDocPages(): string[] {
  const src = readFileSync("site/build-docs.mjs", "utf8");
  const block = /export const DOCS = \[([\s\S]*?)\n\];/.exec(src);
  if (!block) {
    throw new Error("site/build-docs.mjs: DOCS 배열을 찾지 못했다");
  }
  return [...block[1].matchAll(/out:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * `buildSite()`가 문서 페이지를 실제로 쓰는 하위 디렉터리 이름
 * (`join(OUT, <this>, doc.out)`, `site/build-docs.mjs`).
 *
 * ‼️ 이 세그먼트를 리터럴로 복제하면 `join(OUT, "docs", ...)`가
 * `join(OUT, "guide", ...)`로 바뀌어도 아래 테스트들은 계속 통과한 채 모든
 * Help 메뉴가 404가 된다 — URL 핀이 막으려던 바로 그 실패 유형이다.
 */
function siteDocsOutDir(): string {
  const src = readFileSync("site/build-docs.mjs", "utf8");
  const m = /join\(OUT,\s*"([^"]+)",\s*doc\.out\)/.exec(src);
  if (!m) {
    throw new Error("site/build-docs.mjs: 문서 출력 디렉터리를 찾지 못했다");
  }
  return m[1];
}

/** `site/index.html`의 canonical URL. */
function siteCanonicalUrl(): string {
  const html = readFileSync("site/index.html", "utf8");
  const m = /<link rel="canonical" href="([^"]+)"\s*\/?>/.exec(html);
  if (!m) {
    throw new Error("site/index.html: canonical link을 찾지 못했다");
  }
  return m[1];
}

describe("help-urls ↔ site/build-docs.mjs", () => {
  it("사이트가 만드는 문서 페이지를 스캔한다 (빈손 방지)", () => {
    expect(siteDocPages()).toEqual([
      "user-guide.html",
      "keyboard-shortcuts.html",
      "faq.html",
    ]);
  });

  it("문서 출력 디렉터리도 사이트에서 스캔한다 (빈손 방지)", () => {
    expect(siteDocsOutDir()).toBe("docs");
  });

  it("앱이 여는 모든 Help URL이 사이트가 실제로 만드는 페이지를 가리킨다", () => {
    // DOCS_PREFIX 자체를 스캔한 디렉터리 세그먼트에서 조립한다 — "docs"를
    // 앱 쪽에 다시 리터럴로 박으면 위 실패 유형을 못 잡는다.
    const docsPrefix = `${BARAM_HOMEPAGE}${siteDocsOutDir()}/`;
    const pages = siteDocPages();
    const urls = Object.values(HELP_DOC_URLS);
    expect(urls).toHaveLength(3);
    for (const url of urls) {
      expect(url.startsWith(docsPrefix)).toBe(true);
      expect(pages).toContain(url.slice(docsPrefix.length));
    }
  });

  it("모든 URL이 https다 — openUrl은 opener:default(http·https·mailto·tel)만 연다", () => {
    for (const url of [BARAM_HOMEPAGE, ...Object.values(HELP_DOC_URLS)]) {
      expect(url.startsWith("https://")).toBe(true);
    }
  });

  it("BARAM_HOMEPAGE가 site/index.html의 canonical URL과 같다 (origin이 안 묶여 있으면 저장소 이름 변경·커스텀 도메인이 Help 메뉴 4개를 조용히 깨뜨린다)", () => {
    expect(siteCanonicalUrl()).toBe(BARAM_HOMEPAGE);
  });
});
