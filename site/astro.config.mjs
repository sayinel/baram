// Baram 홈페이지 + 문서 사이트.
// 설계: dev/design/specs/2026-09-06-docs-site-i18n-restructure-design.md
// 페이지 트리: dev/design/specs/2026-09-06-docs-site-ia-tree.md (canonical = ./ia-tree.mjs)
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import { GROUPS, groupOf, PAGES } from "./ia-tree.mjs";
import { ROUTES, absolute, ASTRO_BASE, legacyTargets, ORIGIN, starlightLocales, withBase } from "./routes.mjs";
import { EN_DOCS, pageFile } from "./scripts/docs-fs.mjs";
import { legacyRedirects } from "./src/integrations/legacy-redirects.mjs";

/**
 * IA 매니페스트의 페이지 slug → Starlight 사이드바 slug.
 * 문서는 `/<locale>/docs/**` 아래 있다 (랜딩이 `/<locale>/` 를 차지하므로).
 * `index` 페이지는 디렉터리 루트로 접히므로 slug 가 `docs` 다.
 */
const sidebarSlug = (pageSlug) => (pageSlug === "index" ? "docs" : `docs/${pageSlug}`);

/**
 * 그 페이지의 영문 원본이 실제로 있는가. 없으면 사이드바에서 뺀다.
 * 확장자 목록과 경로 규칙은 `scripts/docs-fs.mjs` 하나에 둔다 — 여기에 다시 적으면
 * 게이트가 보는 파일 집합과 사이드바가 보는 집합이 갈린다.
 */
const exists = (pageSlug) => pageFile(EN_DOCS, pageSlug) !== null;

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
  // 커스텀 도메인(baram.ing)이므로 사이트는 도메인 루트에서 서빙된다 — base 는 `"/"` 다.
  // 리포명 아래로 서빙되는 기본 도메인으로 되돌린다면 help-routes.json 의 `base` 만 바꾼다.
  site: ORIGIN,
  base: ASTRO_BASE,
  trailingSlash: "always",
  integrations: [
    legacyRedirects({ absolute, targets: legacyTargets(), withBase }),
    starlight({
      title: "Baram",
      // 사이드바 머리의 워드마크. 랜딩 nav 와 **같은 파일**을 쓴다 —
      // `src/` 아래여야 Astro 가 import 로 해석하므로 public/ 에서 옮겨 왔다.
      // `replacesTitle` 은 워드마크에 이미 "Baram" 이 그려져 있어서다.
      logo: {
        light: "./src/assets/baram-logo.png",
        dark: "./src/assets/baram-logo-dark.png",
        replacesTitle: true,
      },
      description: "A lightweight, beautiful WYSIWYG markdown editor with AI integration.",
      // 로케일 대칭 — root locale 을 쓰지 않는다.
      // 근거: 현 사이트의 브라우저 언어 감지를 보존하고, 원문↔번역 짝이
      // 경로 첫 세그먼트만 달라지게 한다 (설계 문서 'URL 구조' 참조).
      defaultLocale: ROUTES.defaultLocale,
      // ‼️ 로케일을 여기 직접 적으면 `ROUTES.locales` 와 갈라진다. 그러면 신선도 판정이
      //    그 로케일에서 **조용히 꺼진다** — routeData 의 `LOCALES` 에 없으니 스탬프도
      //    안 요구하고 고아도 안 잡는다. 그래서 help-routes.json 에서 파생시킨다.
      locales: starlightLocales(),
      // 토큰 매핑과 문서 페이지 컴포넌트 스타일을 나눈다 — 앞은 이름만 잇는 파일이다.
      customCss: ["./src/styles/starlight-tokens.css", "./src/styles/docs.css"],
      // 낡은 번역 판정(routeData)과 그 표시(Banner). 판정은 렌더와 분리해 둔다 —
      // 고아 번역을 빌드 실패로 만드는 일이 컴포넌트가 렌더되는지에 달리면 안 된다.
      routeMiddleware: "./src/routeData.ts",
      // 오버라이드. SocialIcons 는 GitHub 링크에 별 개수를 붙이려고 덮는다 —
      // 기본 구현은 아이콘만 내고, 랜딩 nav 에는 배지가 있어 두 헤더가 달라 보였다.
      components: {
        Banner: "./src/components/Banner.astro",
        SocialIcons: "./src/components/SocialIcons.astro",
      },
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
