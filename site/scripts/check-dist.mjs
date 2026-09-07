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
import { PAGES } from "../ia-tree.mjs";
import { absolute, BASE, docPath, legacyTargets, withBase } from "../routes.mjs";
import {
  frontmatterSourceHash,
  hashSourceFile,
  splitFrontmatter,
  translationState,
} from "../src/lib/source-hash.ts";
import { EN_DOCS, KO_DOCS, pageFile, slugsOn } from "./docs-fs.mjs";

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
const koOnDisk = slugsOn(KO_DOCS);
if (!koOnDisk.length) {
  console.log("ℹ️ ko 페이지가 없어 낡음 판정 대조를 건너뜁니다 (단정이 공허해진다)");
}
for (const slug of koOnDisk) {
  const enFile = pageFile(EN_DOCS, slug);
  if (!enFile) continue; // 고아는 3번이 이미 신고했다
  const parts = splitFrontmatter(readFileSync(pageFile(KO_DOCS, slug), "utf8"));
  const expected = hashSourceFile(readFileSync(enFile, "utf8"), `en/${slug}`);
  const state = translationState(expected, parts ? frontmatterSourceHash(parts.frontmatter) : undefined);

  const built = resolveInDist(withBase(docPath(slug, "ko")));
  if (!built) { problems.push(`[산출물 없음] ko/${slug} 가 dist 에 없다`); continue; }
  const shown = readFileSync(built, "utf8").includes("data-stale-translation");
  if (state === "stale" && !shown) {
    problems.push(`[판정 불일치] ko/${slug} — 디스크는 낡음인데 배너가 없다 (두 해시 계산이 갈렸다)`);
  }
  if (state === "current" && shown) {
    problems.push(`[판정 불일치] ko/${slug} — 디스크는 최신인데 배너가 떴다 (두 해시 계산이 갈렸다)`);
  }
}

// 미번역(폴백) 페이지는 절대 낡음 배너를 달면 안 된다.
// ‼️ 폴백 라우트는 `id` 가 `ko/...` 인데 `entry` 는 **en 엔트리**다(Starlight 실측).
//    판정을 `route.id` 로 갈랐다면 미번역 56페이지가 전부 여기서 걸렸을 것이다.
for (const slug of slugsOn(EN_DOCS)) {
  if (koOnDisk.includes(slug)) continue;
  const built = resolveInDist(withBase(docPath(slug, "ko")));
  if (built && readFileSync(built, "utf8").includes("data-stale-translation")) {
    problems.push(`[폴백에 배너] ko/${slug} 는 미번역인데 낡음 배너가 붙었다`);
  }
}

const total = PAGES.length;
const done = PAGES.filter((p) => migrated(p.slug)).length;
console.log(`이주 ${done}/${total} 페이지 · en ${enPages.length}개 · ko ${koPages.length}개 · 구 URL 스텁 ${legacy.length}개`);
if (pending.length) {
  console.log(`\n⏳ 이주 대기 ${pending.length}건 (결함 아님)`);
  for (const p of pending) console.log("  " + p);
}
console.log();
if (!problems.length) console.log("✅ 산출물 문제 없음");
else { console.log(`❌ ${problems.length}건`); for (const p of problems) console.log("  " + p); }
process.exitCode = problems.length ? 1 : 0;
