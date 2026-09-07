// Baram 홈페이지 + 문서 사이트.
// 설계: dev/design/specs/2026-09-06-docs-site-i18n-restructure-design.md
// 페이지 트리: dev/design/specs/2026-09-06-docs-site-ia-tree.md (canonical = ./ia-tree.mjs)
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import { GROUPS, groupOf, PAGES } from "./ia-tree.mjs";
import { ROUTES, absolute, BASE, legacyTargets, ORIGIN, withBase } from "./routes.mjs";
import { legacyRedirects } from "./src/integrations/legacy-redirects.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(HERE, "src/content/docs");

/**
 * IA 매니페스트의 페이지 slug → Starlight 사이드바 slug.
 * 문서는 `/<locale>/docs/**` 아래 있다 (랜딩이 `/<locale>/` 를 차지하므로).
 * `index` 페이지는 디렉터리 루트로 접히므로 slug 가 `docs` 다.
 */
const sidebarSlug = (pageSlug) => (pageSlug === "index" ? "docs" : `docs/${pageSlug}`);

/** 그 페이지의 영문 원본이 실제로 있는가. 없으면 사이드바에서 뺀다. */
function exists(pageSlug) {
  const rel = pageSlug === "index" ? "docs/index" : `docs/${pageSlug}`;
  return ["md", "mdx"].some((ext) => existsSync(join(CONTENT, "en", `${rel}.${ext}`)));
}

/**
 * 사이드바를 IA 매니페스트에서 생성한다 — 손으로 적으면 트리와 갈라진다.
 *
 * ‼️ **아직 없는 페이지는 건너뛴다.** 3단계에서 57페이지를 한 번에 채우지 않고
 *    하나씩 이주하는데, 없는 slug를 참조하면 Starlight이 빌드를 실패시킨다.
 *    이 필터가 "중간 상태가 항상 배포 가능"을 보장한다. 미충족 페이지는
 *    `npm run site:ia` 가 별도로 보고한다 — 조용히 사라지지 않는다.
 */
function buildSidebar() {
  const out = [];
  let run = null;
  for (const page of PAGES) {
    if (!exists(page.slug)) { run = null; continue; }
    const group = groupOf(page.slug);
    if (group === null) {
      run = null;
      out.push({ slug: sidebarSlug(page.slug) });
      continue;
    }
    if (run?.group !== group) {
      run = { group, label: GROUPS[group].en, translations: { ko: GROUPS[group].ko }, collapsed: true, items: [] };
      out.push(run);
    }
    run.items.push(sidebarSlug(page.slug));
  }
  return out.map(({ group: _group, ...item }) => item);
}

export default defineConfig({
  // GitHub Pages는 리포 이름 아래로 서빙한다 — base 를 빼면 모든 링크가 깨진다.
  site: ORIGIN,
  base: BASE,
  trailingSlash: "always",
  integrations: [
    legacyRedirects({ absolute, targets: legacyTargets(), withBase }),
    starlight({
      title: "Baram",
      description: "A lightweight, beautiful WYSIWYG markdown editor with AI integration.",
      // 로케일 대칭 — root locale 을 쓰지 않는다.
      // 근거: 현 사이트의 브라우저 언어 감지를 보존하고, 원문↔번역 짝이
      // 경로 첫 세그먼트만 달라지게 한다 (설계 문서 'URL 구조' 참조).
      defaultLocale: ROUTES.defaultLocale,
      locales: {
        en: { label: "English", lang: "en" },
        ko: { label: "한국어", lang: "ko" },
      },
      customCss: ["./src/styles/starlight-tokens.css"],
      // 낡은 번역 판정(routeData)과 그 표시(Banner). 판정은 렌더와 분리해 둔다 —
      // 고아 번역을 빌드 실패로 만드는 일이 컴포넌트가 렌더되는지에 달리면 안 된다.
      routeMiddleware: "./src/routeData.ts",
      components: { Banner: "./src/components/Banner.astro" },
      sidebar: buildSidebar(),
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/sayinel/baram" }],
      plugins: [
        starlightLinksValidator({
          // ‼️ `errorOnFallbackPages` 기본값 true 는 **미번역 페이지로 가는 링크를 전부
          //    무효로 본다** — 번역된 ko 페이지가 아직 번역 안 된 ko 페이지를 가리키면
          //    실제로는 폴백으로 멀쩡히 열리는데 빌드가 실패한다(ko 첫 페이지에서 15건 실측).
          //    끈다고 검증이 약해지지 않는다: 플러그인은 기본 로케일 짝을 찾아 앵커까지
          //    그쪽으로 검사하고, 그 짝도 없으면 여전히 무효로 신고한다.
          errorOnFallbackPages: false,
          // ‼️ 되켰다. 이걸 끄고 있던 동안 **죽은 상대 링크 8개가 실제로 배포돼 있었다** —
          //    `../README.md#build-from-source`, `../examples/plugins/...` 처럼 원래
          //    리포 안 경로였던 것들이 사이트로 옮겨지면서 전부 404 가 됐다. 절대 URL 로
          //    바꿨으니 이제 상대 링크는 0건이고, 켜 두면 같은 부류가 다시 못 들어온다.
        }),
      ],
    }),
  ],
});
