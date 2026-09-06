// §4.2 앱이 여는 Help URL ↔ 사이트가 생성하는 문서 페이지의 짝.
//
// ‼️ 기대값을 앱 쪽에 리터럴로 복제하면 사이트 파일명이 바뀔 때 앱만 404가 된다.
// 그래서 `site/build-docs.mjs`의 DOCS에서 파생시킨다. 스캔이 빈손이면 어떤 단정도
// 공허해지므로, 먼저 스캔 결과 자체를 고정한다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BARAM_HOMEPAGE, HELP_DOC_URLS } from "../help-urls";

const DOCS_PREFIX = `${BARAM_HOMEPAGE}docs/`;

/** `site/build-docs.mjs`의 DOCS 배열이 생성하는 out 파일명들. */
function siteDocPages(): string[] {
  const src = readFileSync("site/build-docs.mjs", "utf8");
  const block = /export const DOCS = \[([\s\S]*?)\n\];/.exec(src);
  if (!block) {
    throw new Error("site/build-docs.mjs: DOCS 배열을 찾지 못했다");
  }
  return [...block[1].matchAll(/out:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("help-urls ↔ site/build-docs.mjs", () => {
  it("사이트가 만드는 문서 페이지를 스캔한다 (빈손 방지)", () => {
    expect(siteDocPages()).toEqual([
      "user-guide.html",
      "keyboard-shortcuts.html",
      "faq.html",
    ]);
  });

  it("앱이 여는 모든 Help URL이 사이트가 실제로 만드는 페이지를 가리킨다", () => {
    const pages = siteDocPages();
    const urls = Object.values(HELP_DOC_URLS);
    expect(urls).toHaveLength(3);
    for (const url of urls) {
      expect(url.startsWith(DOCS_PREFIX)).toBe(true);
      expect(pages).toContain(url.slice(DOCS_PREFIX.length));
    }
  });

  it("모든 URL이 https다 — openUrl은 opener:default(http·https·mailto·tel)만 연다", () => {
    for (const url of [BARAM_HOMEPAGE, ...Object.values(HELP_DOC_URLS)]) {
      expect(url.startsWith("https://")).toBe(true);
    }
  });
});
