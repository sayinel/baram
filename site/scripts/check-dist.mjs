#!/usr/bin/env node
// 빌드 산출물을 직접 단정한다. `npm run check:dist` (build 이후)
//
// ‼️ 설정을 읽는 것으로는 부족하다. Astro 내장 `redirects` 는 설정상 맞아 보이는데도
//    목적지에 `base` 를 붙이지 않아 존재하지 않는 주소로 보내는 스텁을 냈고,
//    `trailingSlash: "always"` 와 겹쳐 파일 대신 디렉터리를 만들었다.
//    그걸 잡은 것은 "스텁의 목적지가 dist 안에 실제로 있는가"라는 단정 하나였다.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { groupOf, PAGES } from "../ia-tree.mjs";
import { absolute, BASE, docPath, legacyTargets, ROUTES, withBase } from "../routes.mjs";
import {
  frontmatterSourceHash,
  hashSourceFile,
  splitFrontmatter,
  translationState,
} from "../src/lib/source-hash.ts";
import { EN_DOCS, pageFile, slugsOn, TRANSLATION_DIRS } from "./docs-fs.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

const problems = [];
const pending = [];

if (!existsSync(DIST)) {
  console.error("❌ dist/ 가 없습니다 — 먼저 `npm run build`");
  process.exit(1);
}

/** 그 IA slug 의 영문 원본이 실제로 있는가 (3단계 이주 진행도) */
const migrated = (slug) => pageFile(EN_DOCS, slug) !== null;

/** base 붙은 URL 경로가 dist 안에서 가리키는 파일 */
function resolveInDist(urlPath) {
  if (!urlPath.startsWith(`${BASE}/`)) return null;
  const rel = urlPath.slice(BASE.length + 1);
  for (const candidate of [rel, join(rel, "index.html"), `${rel.replace(/\/$/, "")}.html`]) {
    const p = join(DIST, candidate);
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** `dist/<locale>/` 아래 index.html 들을 로케일 없는 경로로 모은다 */
function pagesUnder(locale) {
  const found = [];
  const walk = (dir, prefix) => {
    let names;
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, `${prefix}${name}/`);
      else if (name === "index.html") found.push(prefix);
    }
  };
  walk(join(DIST, locale), "");
  return found;
}

// ── 1. 구 URL 스텁
const legacy = legacyTargets();
if (!legacy.length) problems.push("help-routes.json 에 legacy 항목이 없습니다");
for (const { from, slug, to } of legacy) {
  const stub = join(DIST, from.replace(/^\//, ""));
  if (!existsSync(stub)) { problems.push(`[스텁 없음] ${from}`); continue; }
  if (!statSync(stub).isFile()) {
    problems.push(`[스텁이 디렉터리] ${from} — 구 URL은 슬래시 없는 파일 요청이다`);
    continue;
  }
  const html = readFileSync(stub, "utf8");
  const target = /content="0;url=([^"]+)"/.exec(html)?.[1];
  const canonical = /rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  if (target !== withBase(to)) problems.push(`[목적지 불일치] ${from} → ${target} (기대 ${withBase(to)})`);
  if (canonical !== absolute(to)) problems.push(`[canonical 불일치] ${from} → ${canonical} (기대 ${absolute(to)})`);
  // 결정적 단정 — 목적지가 실재하는가. 아직 이주 전이면 결함이 아니라 진행도다.
  if (target && !resolveInDist(target)) {
    (migrated(slug) ? problems : pending).push(
      migrated(slug)
        ? `[목적지 부재] ${from} → ${target} 가 dist 안에 없다`
        : `${from} → ${slug} (아직 이주 전)`,
    );
  }
}

// ── 2. entries 의 slug 가 IA 트리에 실재하는지 (앱 계약이 트리와 갈라지지 않게)
const known = new Set(PAGES.map((p) => p.slug));
for (const { key, slug } of legacy) {
  if (!known.has(slug)) problems.push(`[미등록 slug] entries.${key} = "${slug}" 가 IA 트리에 없다`);
}

// ── 3. 로케일 폴백과 대칭
const enPages = pagesUnder("en");
const koPages = pagesUnder("ko");
if (!enPages.length) problems.push("dist/en 아래 페이지가 없습니다");
for (const page of enPages) {
  if (!koPages.includes(page)) problems.push(`[폴백 없음] en/${page} 에 대응하는 ko 페이지가 없다`);
}
for (const page of koPages) {
  if (!enPages.includes(page)) problems.push(`[고아 번역] ko/${page} 에 대응하는 en 페이지가 없다`);
}

// ── 4. 낡음 판정이 **두 곳에서 같은가** (§4.2)
//
// ‼️ 이것이 이 기능의 핵심 단정이다. 해시를 내는 곳이 둘이다 — 스탬프 도구는 디스크에서
//    프론트매터를 잘라 계산하고, 빌드는 Astro 가 파싱한 `entry.body`/`entry.data.title`
//    로 계산한다. 둘이 갈리면 스탬프를 찍자마자 낡음으로 뜨거나(과잉) 영영 안 뜬다(침묵).
//    소스만 보는 단위 테스트로는 절대 못 잡는다 — **디스크 판정 vs 렌더된 배너**를
//    산출물에서 맞대야 한다.
const enOnDisk = slugsOn(EN_DOCS);
let compared = 0;
for (const { dir, locale } of TRANSLATION_DIRS) {
  const onDisk = slugsOn(dir);
  for (const slug of onDisk) {
    const enFile = pageFile(EN_DOCS, slug);
    if (!enFile) continue; // 고아는 3번이 이미 신고했다
    const parts = splitFrontmatter(readFileSync(pageFile(dir, slug), "utf8"));
    const expected = hashSourceFile(readFileSync(enFile, "utf8"), `en/${slug}`);
    const state = translationState(expected, parts ? frontmatterSourceHash(parts.frontmatter) : undefined);

    const built = resolveInDist(withBase(docPath(slug, locale)));
    if (!built) { problems.push(`[산출물 없음] ${locale}/${slug} 가 dist 에 없다`); continue; }
    const html = readFileSync(built, "utf8");
    const shown = html.includes("data-stale-translation");
    compared += 1;
    if (state === "stale" && !shown) {
      problems.push(`[판정 불일치] ${locale}/${slug} — 디스크는 낡음인데 배너가 없다 (두 해시 계산이 갈렸다)`);
    }
    if (state === "current" && shown) {
      problems.push(`[판정 불일치] ${locale}/${slug} — 디스크는 최신인데 배너가 떴다 (두 해시 계산이 갈렸다)`);
    }
    // ‼️ 배너가 **있다**는 것만으로는 부족하다. 그 안의 "원문 보기" href 는 우리가
    //    조립한 것이고 `starlightLinksValidator` 는 컴포넌트가 만든 href 를 못 본다.
    //    이 파일이 존재하는 이유가 바로 그 부류다 — 스텁의 목적지가 dist 안에 실재하는지
    //    묻는 단정 하나가 base 누락을 잡았다. 같은 질문을 배너에도 한다.
    if (shown) {
      // 마커 뒤 첫 링크를 잡는다 — 속성 순서나 클래스에 기대지 않는다.
      const after = html.slice(html.indexOf("data-stale-translation"));
      const href = /<a href="([^"]+)"/.exec(after)?.[1];
      if (!href) problems.push(`[배너 링크 없음] ${locale}/${slug} — 배너에 원문 링크가 없다`);
      else if (!resolveInDist(href)) {
        problems.push(`[배너 링크 부재] ${locale}/${slug} → ${href} 가 dist 안에 없다`);
      }
    }
  }

  // 미번역(폴백) 페이지는 절대 낡음 배너를 달면 안 된다.
  // ‼️ 폴백 라우트는 `id` 가 `ko/...` 인데 `entry` 는 **en 엔트리**다(Starlight 실측).
  //    판정을 `route.id` 로 갈랐다면 미번역 페이지가 전부 여기서 걸렸을 것이다.
  for (const slug of enOnDisk) {
    if (onDisk.includes(slug)) continue;
    const built = resolveInDist(withBase(docPath(slug, locale)));
    if (built && readFileSync(built, "utf8").includes("data-stale-translation")) {
      problems.push(`[폴백에 배너] ${locale}/${slug} 는 미번역인데 낡음 배너가 붙었다`);
    }
  }
}
if (!compared) {
  console.log("ℹ️ 번역 페이지가 없어 낡음 판정 대조를 건너뜁니다 (단정이 공허해진다)");
}

// ── 5. 문서 홈의 주제 카드 — **컴포넌트가 만든 링크**다
//
// ‼️ `starlightLinksValidator` 는 마크다운·MDX 본문의 링크만 본다. 이 카드들은
//    `DocsHome.astro` 가 PAGES·GROUPS 에서 조립하므로 그 검사 밖이고, check-pages 는
//    매니페스트↔디스크만 본다. 즉 카드 링크가 전부 404 여도 모든 게이트가 초록이다 —
//    이 파일이 존재하는 이유가 정확히 그 부류다(구 URL 스텁의 base 누락을 잡은 단정과
//    같은 질문). 여기서 묻는 것 셋: 개수가 파생값과 같은가, 링크가 dist 안에 실재하는가,
//    로케일 사이에 대칭인가.
const TOPIC_GRID = '<div class="docs-home-topics">';
/**
 * 그 로케일의 문서 홈에 있어야 할 카드 링크 — **순서까지** 그대로.
 *
 * ‼️ 개수만 세면 안 된다. 개수 단정은 `DocsHome` 이 그룹의 **마지막** 페이지로 착지하게
 *    바뀌어도 통과한다(15개 그대로 · 전부 실재 · 로케일 대칭) — 모든 카드가 엉뚱한 곳을
 *    가리키는데 초록이다. 그래서 목록을 파생시켜 그대로 맞댄다.
 * ‼️ `migrated` 필터는 컴포넌트와 같은 판정이다(그쪽은 컬렉션에, 여기는 디스크에 묻는다).
 *    빼면 en 원문이 아직 없는 slug 를 매니페스트에 넣은 날 "카드 개수" 로 신고되는데,
 *    진짜 원인은 check-pages 의 `[파일 없음]` 이라 엉뚱한 곳을 보게 만든다.
 */
function expectedCardHrefs(locale) {
  const out = [];
  const seen = new Set();
  for (const page of PAGES) {
    if (page.slug === "index" || !migrated(page.slug)) continue;
    const key = groupOf(page.slug) ?? page.slug;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(withBase(docPath(page.slug, locale)));
  }
  return out;
}
let cardLocales = 0;
for (const locale of ROUTES.locales) {
  const built = resolveInDist(withBase(docPath("index", locale)));
  if (!built) { problems.push(`[문서 홈 없음] ${locale} — dist 에 문서 홈이 없다`); continue; }
  const html = readFileSync(built, "utf8");
  const at = html.indexOf(TOPIC_GRID);
  if (at < 0) {
    problems.push(`[주제 카드 없음] ${locale} 문서 홈에 ${TOPIC_GRID} 가 없다 — DocsHome 이 렌더되지 않았다`);
    continue;
  }
  // 격자 다음 H2 까지가 카드 구역이다. 뒤의 "자주 찾는 것" 목록 링크까지 세면 안 된다.
  const nextHeading = html.indexOf("<h2", at);
  const section = html.slice(at, nextHeading < 0 ? undefined : nextHeading);
  // ‼️ `href` 가 첫 속성이라고 가정하지 않는다. LinkCard 가 지금은 `href` 만 펼치지만,
  //    Starlight·Astro 가 앞에 속성 하나(`data-astro-prefetch` 등)를 끼우면 좁은 정규식은
  //    **0건을 매치**한다 — 아래 단정이 잡아 주기는 하지만 엉뚱한 진단이 된다.
  const hrefs = [...section.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  const want = expectedCardHrefs(locale);
  cardLocales += 1;
  if (hrefs.join("\n") !== want.join("\n")) {
    const at0 = hrefs.findIndex((h, i) => h !== want[i]);
    problems.push(
      `[카드 링크] ${locale} 문서 홈의 카드 링크가 PAGES·GROUPS 에서 파생한 목록과 다르다 ` +
        `(카드 ${hrefs.length}개 / 기대 ${want.length}개` +
        (at0 >= 0 ? `, ${at0}번째: "${hrefs[at0] ?? "(없음)"}" ≠ "${want[at0] ?? "(없음)"}"` : "") +
        `)`,
    );
  }
  // 목록이 맞아도 그 목적지가 실재하는지는 별개다 — 이 파일이 존재하는 이유가 그 질문이다.
  for (const href of hrefs) {
    if (!resolveInDist(href)) problems.push(`[카드 링크 부재] ${locale} 문서 홈 → ${href} 가 dist 안에 없다`);
  }
}
if (!cardLocales) problems.push("[문서 홈 0개] 카드 단정이 한 로케일에서도 돌지 않았다");

// ── 6. robots.txt — 크롤러에게 주는 **유일한 절대 URL**
//
// ‼️ 파생시켰다는 것과 산출물이 옳다는 것은 다른 말이다. 엔드포인트가 빌드에서 빠지거나
//    (`src/pages/` 밖으로 옮기면 그렇게 된다) sitemap 파일 이름이 바뀌어도 다른 게이트는
//    전부 초록이다 — 이 파일이 존재하는 이유가 정확히 그 부류다. 그래서 셋을 묻는다:
//    파일이 났는가, 그 URL 이 routes 가 조립한 것과 같은가, 가리키는 대상이 dist 에 있는가.
const robotsFile = join(DIST, "robots.txt");
const wantSitemap = absolute("/sitemap-index.xml");
if (!existsSync(robotsFile)) {
  problems.push("[robots.txt 없음] 크롤러가 sitemap 을 못 찾는다");
} else {
  const declared = /^Sitemap:\s*(\S+)$/m.exec(readFileSync(robotsFile, "utf8"))?.[1];
  if (!declared) problems.push("[robots.txt] Sitemap 줄이 없다");
  else if (declared !== wantSitemap) {
    problems.push(`[robots.txt] Sitemap ${declared} (기대 ${wantSitemap})`);
  } else if (!resolveInDist(withBase("/sitemap-index.xml"))) {
    problems.push(`[robots.txt] 가리키는 ${wantSitemap} 가 dist 안에 없다`);
  }
}

// ── 7. 랜딩 헤더의 컨트롤 — **이 리포가 직접 조립한** 값들이다
//
// ‼️ 문서 헤더는 Starlight 이 만들고 그쪽 게이트가 지키지만, 랜딩 헤더는 우리 것이다.
//    언어 select 의 값은 `withBase` 로 만든 경로라 base 가 빠지면 그대로 404 가 되는데
//    링크 검사기는 마크다운 본문만 본다 — 구 URL 스텁이 정확히 그렇게 깨졌다.
//    테마 선택지는 Starlight 과 **같은 3-상태**여야 두 표면의 저장값이 갈리지 않는다.
const THEME_VALUES = "dark,light,auto";
let landings = 0;
for (const locale of ROUTES.locales) {
  const file = join(DIST, locale, "index.html");
  if (!existsSync(file)) {
    problems.push(`[랜딩 없음] ${locale}/index.html 이 dist 에 없다`);
    continue;
  }
  const html = readFileSync(file, "utf8");
  landings += 1;

  if (!html.includes('id="nav-toggle"')) {
    problems.push(`[모바일 토글 없음] ${locale} 랜딩 — 좁은 화면에서 nav 를 접을 수 없다`);
  }

  // 별 배지 훅. 개수는 런타임 fetch 라 여기서 잴 수 없지만, 훅이 사라지면 배지도 사라진다.
  if (!html.includes("data-github-stars")) {
    problems.push(`[별 배지 훅 없음] ${locale} 랜딩 — GitHub 껍데기에 개수 자리가 없다`);
  }

  const themeAt = html.indexOf('id="theme-select"');
  const themeBlock = themeAt < 0 ? "" : html.slice(themeAt, html.indexOf("</select>", themeAt));
  const themeValues = [...themeBlock.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]).join(",");
  if (themeValues !== THEME_VALUES) {
    problems.push(`[테마 선택지] ${locale} 랜딩 → "${themeValues}" (기대 "${THEME_VALUES}")`);
  }

  const langAt = html.indexOf('id="lang-select"');
  const langBlock = langAt < 0 ? "" : html.slice(langAt, html.indexOf("</select>", langAt));
  const langOptions = [...langBlock.matchAll(/<option value="([^"]+)"( selected)?/g)];
  if (langOptions.length !== ROUTES.locales.length) {
    problems.push(`[언어 선택지 개수] ${locale} 랜딩 → ${langOptions.length}개 (기대 ${ROUTES.locales.length}개)`);
  }
  for (const [, href] of langOptions) {
    if (!resolveInDist(href)) problems.push(`[언어 링크 부재] ${locale} 랜딩 → ${href} 가 dist 안에 없다`);
  }
  // 문서 헤더와 같은 의미인가 — **현재** 언어가 선택돼 있어야 한다(갈 곳이 아니라).
  const selected = langOptions.find((m) => m[2])?.[1];
  if (selected !== withBase(`/${locale}/`)) {
    problems.push(`[현재 언어 표시] ${locale} 랜딩 → ${selected ?? "(없음)"} (기대 ${withBase(`/${locale}/`)})`);
  }
}
if (!landings) problems.push("[랜딩 0개] 헤더 단정이 한 로케일에서도 돌지 않았다");

// 문서 헤더도 **같은 배지**를 낸다. Starlight 기본 `SocialIcons` 는 아이콘만 내므로,
// 오버라이드(astro.config 의 `components.SocialIcons`) 가 빠지면 조용히 옛 모양으로
// 돌아가 두 헤더가 다시 갈린다 — 설정 한 줄이라 사라지기 쉽다.
for (const locale of ROUTES.locales) {
  const file = resolveInDist(withBase(docPath("index", locale)));
  if (!file) continue; // 문서 홈 부재는 위 단정들이 잡는다
  if (!readFileSync(file, "utf8").includes("data-github-stars")) {
    problems.push(`[별 배지 훅 없음] ${locale} 문서 헤더 — SocialIcons 오버라이드가 빠졌다`);
  }
}

const total = PAGES.length;
const done = PAGES.filter((p) => migrated(p.slug)).length;
console.log(
  `이주 ${done}/${total} 페이지 · en ${enPages.length}개 · ko ${koPages.length}개 · ` +
    `구 URL 스텁 ${legacy.length}개 · 문서 홈 주제 카드 ${expectedCardHrefs(ROUTES.defaultLocale).length}개 × ${cardLocales}로케일`,
);
if (pending.length) {
  console.log(`\n⏳ 이주 대기 ${pending.length}건 (결함 아님)`);
  for (const p of pending) console.log("  " + p);
}
console.log();
if (!problems.length) console.log("✅ 산출물 문제 없음");
else { console.log(`❌ ${problems.length}건`); for (const p of problems) console.log("  " + p); }
process.exitCode = problems.length ? 1 : 0;
