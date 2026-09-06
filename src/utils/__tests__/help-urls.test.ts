// §4.2 앱이 여는 Help URL ↔ 사이트가 생성하는 문서 페이지의 짝.
//
// ‼️ 기대값을 앱 쪽에 리터럴로 복제하면 사이트 경로가 바뀔 때 앱만 404가 된다.
// 그래서 `site/help-routes.json`(계약의 단일 출처)과 `site/ia-tree.mjs`(페이지 트리
// canonical)에서 파생시킨다. 스캔이 빈손이면 어떤 단정도 공허해지므로 먼저 스캔 결과
// 자체를 고정한다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AVAILABLE_LOCALES, type Locale } from "../../i18n";
import { BARAM_HOMEPAGE, type HelpDoc, helpDocUrl } from "../help-urls";

interface HelpRoutes {
  base: string;
  defaultLocale: string;
  docsPrefix: string;
  entries: Record<string, string>;
  locales: string[];
  origin: string;
}

function siteRoutes(): HelpRoutes {
  return JSON.parse(
    readFileSync("site/help-routes.json", "utf8"),
  ) as HelpRoutes;
}

/** `site/ia-tree.mjs` 가 선언한 페이지 slug 전부. */
function siteSlugs(): string[] {
  const src = readFileSync("site/ia-tree.mjs", "utf8");
  const slugs = [...src.matchAll(/\{\s*slug:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (slugs.length < 50) {
    throw new Error(
      `site/ia-tree.mjs: slug 스캔이 ${slugs.length}개 — 형식이 바뀌었다`,
    );
  }
  return slugs;
}

describe("help-urls ↔ 사이트 계약", () => {
  it("스캔이 실제로 값을 집는다 (빈손이면 아래 단정이 모두 공허해진다)", () => {
    const routes = siteRoutes();
    expect(Object.keys(routes.entries).sort()).toEqual([
      "faq",
      "guide",
      "shortcuts",
    ]);
    expect(routes.locales.length).toBeGreaterThanOrEqual(2);
    expect(siteSlugs().length).toBeGreaterThanOrEqual(57);
  });

  it("BARAM_HOMEPAGE가 사이트의 origin + base와 같다", () => {
    // origin이 안 묶여 있으면 저장소 이름 변경·커스텀 도메인이 Help 메뉴 4개를 조용히 깨뜨린다.
    const { base, origin } = siteRoutes();
    expect(BARAM_HOMEPAGE).toBe(`${origin}${base}/`);
  });

  it("앱 로케일 집합이 사이트 로케일 집합과 같다", () => {
    // 앱에만 있는 로케일은 그 언어 사용자를 없는 URL로 보낸다.
    expect([...AVAILABLE_LOCALES].sort()).toEqual(
      [...siteRoutes().locales].sort(),
    );
  });

  it("모든 Help URL이 사이트가 실제로 만드는 페이지를 가리킨다", () => {
    const { docsPrefix, entries } = siteRoutes();
    const slugs = siteSlugs();
    for (const [doc, slug] of Object.entries(entries)) {
      expect(slugs).toContain(slug); // IA 트리에 그 페이지가 있는가
      for (const locale of AVAILABLE_LOCALES) {
        expect(helpDocUrl(doc as HelpDoc, locale)).toBe(
          `${BARAM_HOMEPAGE}${locale}/${docsPrefix}${slug}/`,
        );
      }
    }
  });

  it("로케일마다 다른 URL을 낸다", () => {
    // 로케일 인자를 무시하는 구현이 위 단정을 통과하지 못하게 못 박는다.
    const urls = AVAILABLE_LOCALES.map((l) => helpDocUrl("guide", l));
    expect(new Set(urls).size).toBe(AVAILABLE_LOCALES.length);
  });

  it("모든 URL이 https이고 후행 슬래시로 끝난다", () => {
    // openUrl(plugin-opener)은 capability `opener:default` 범위인 http·https만 연다.
    // 후행 슬래시는 Starlight의 `trailingSlash: "always"`와 맞아야 리다이렉트를 안 탄다.
    const docs: HelpDoc[] = ["guide", "shortcuts", "faq"];
    const all = [
      BARAM_HOMEPAGE,
      ...docs.flatMap((d) => AVAILABLE_LOCALES.map((l) => helpDocUrl(d, l))),
    ];
    for (const url of all) {
      expect(url.startsWith("https://")).toBe(true);
      expect(url.endsWith("/")).toBe(true);
    }
  });

  it("문서 URL이 로케일을 base 바로 뒤에 둔다 (대칭 라우팅)", () => {
    // root locale 로 되돌아가면 원문↔번역 짝이 비대칭이 되고 낡음 대조가 깨진다.
    for (const locale of AVAILABLE_LOCALES satisfies readonly Locale[]) {
      expect(
        helpDocUrl("faq", locale).startsWith(`${BARAM_HOMEPAGE}${locale}/`),
      ).toBe(true);
    }
  });
});
