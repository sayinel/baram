#!/usr/bin/env node
// 살아 있는 페이지 게이트. `npm run check:pages`
//
// 분할은 **일회성 이주**였다(원문 `docs/*.md` 는 그 커밋에서 삭제됐다). 손실 없음은
// `check-roundtrip.mjs` 가 이주 시점에 바이트 동일성으로 증명했고 그 기록은 git 에 있다.
// 이제부터 페이지는 **손으로 고치는 표면**이므로, 게이트가 볼 것은 원문 대조가 아니라
// "매니페스트와 디스크가 서로 맞는가" 다.
//
// ‼️ 번역이 이 파일들을 편집한다. 생성기로 덮어쓰면 번역이 사라진다 —
//    그래서 split-docs.mjs 는 이주 후 다시 돌리지 않는다.
import { readFileSync } from "node:fs";
import { GROUPS, groupOf, PAGES, TITLES } from "../ia-tree.mjs";
import {
  frontmatterSourceHash,
  hashSourceFile,
  splitFrontmatter,
  translationState,
} from "../src/lib/source-hash.ts";
import { EN_DOCS as EN, KO_DOCS as KO, pageFile, slugsOn } from "./docs-fs.mjs";

const FLOOR = 40;
const CEIL = 200;

/** 하한·상한 예외. 이유는 IA 문서가 싣는다. */
const SIZE_EXCEPTIONS = new Set([
  "index", // 문서 홈은 그룹으로 보내는 내비게이션 페이지다 — 짧은 것이 미덕이다
  "editing/source-mode-and-find", // 유일한 병합 대상이 성격이 무관하다
  "versioning/git", // Git 과 파일 스냅샷은 서로 다른 버전 관리 시스템이다
  "customization/keyboard-shortcuts", // 단축키 레퍼런스는 한 화면에서 훑는 것이 본질이다
]);

const problems = [];

const declared = new Set(PAGES.map((p) => p.slug));
const onDisk = slugsOn(EN);

// ── 1. 매니페스트 ↔ 디스크
for (const slug of declared) {
  if (!onDisk.includes(slug)) problems.push(`[파일 없음] ${slug} — 매니페스트에 있으나 en/ 에 없다`);
}
for (const slug of onDisk) {
  if (!declared.has(slug)) problems.push(`[미선언 파일] ${slug} — en/ 에 있으나 매니페스트에 없다`);
}

// ── 2. 제목·프론트매터
for (const slug of onDisk) {
  const raw = readFileSync(pageFile(EN, slug), "utf8");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!fm) { problems.push(`[프론트매터 없음] ${slug}`); continue; }
  if (!/^title:/m.test(fm[1])) problems.push(`[title 없음] ${slug}`);
  if (TITLES[slug] && !fm[1].includes(JSON.stringify(TITLES[slug]))) {
    problems.push(`[제목 불일치] ${slug} — 파일과 TITLES 가 다르다`);
  }
  const body = raw.slice(fm[0].length).split("\n").length;
  if (body < FLOOR && !SIZE_EXCEPTIONS.has(slug)) problems.push(`[하한] ${slug}: ${body}줄 < ${FLOOR}`);
  if (body > CEIL && !SIZE_EXCEPTIONS.has(slug)) problems.push(`[상한] ${slug}: ${body}줄 > ${CEIL}`);
}

// ── 3. 죽은 예외: 규칙을 만족하는데 예외로 남아 있으면 다음 사람이 오해한다
for (const slug of SIZE_EXCEPTIONS) {
  if (!declared.has(slug)) { problems.push(`[고아 예외] ${slug} — 그런 페이지가 없다`); continue; }
  const file = pageFile(EN, slug);
  if (!file) continue;
  const raw = readFileSync(file, "utf8");
  const body = raw.slice(/^---\n[\s\S]*?\n---\n/.exec(raw)?.[0].length ?? 0).split("\n").length;
  if (body >= FLOOR && body <= CEIL) problems.push(`[불필요한 예외] ${slug}: ${body}줄 — 예외에서 지울 것`);
}

// ── 4. 로케일 대칭: ko 는 없어도 되지만(폴백), ko 에만 있으면 고아다
const koSlugs = slugsOn(KO);
for (const slug of koSlugs) {
  if (!onDisk.includes(slug)) problems.push(`[고아 번역] ko/${slug} — 대응하는 en 페이지가 없다`);
}

// ── 5. 그룹 정합
for (const slug of declared) {
  if (slug.includes("/") && groupOf(slug) === null) {
    problems.push(`[미등록 그룹] ${slug} — 접두어가 GROUPS 에 없다`);
  }
}
for (const key of Object.keys(GROUPS)) {
  if (![...declared].some((s) => groupOf(s) === key)) problems.push(`[죽은 그룹] GROUPS.${key}`);
}

// ── 6. 번역 스탬프 (§4.2)
//
// 스탬프가 없는 번역은 **낡음을 판정할 수 없다**. 판정할 수 없는 번역은 배너 없이
// 조용히 신뢰받으므로, 사용자에게 보이는 상태 공간을 {번역됨·낡음·미번역} 셋으로
// 닫는다 — 넷째 상태(모름)는 저자의 실수이지 사용자에게 보일 상태가 아니다.
// 낡음 자체는 결함이 아니라 **알려진 상태**다: 배너가 알리고 여기서는 세기만 한다.
let stale = 0;
for (const slug of koSlugs) {
  if (!onDisk.includes(slug)) continue; // 고아는 4번이 이미 신고했다
  const parts = splitFrontmatter(readFileSync(pageFile(KO, slug), "utf8"));
  if (!parts) { problems.push(`[프론트매터 없음] ko/${slug}`); continue; }
  const expected = hashSourceFile(readFileSync(pageFile(EN, slug), "utf8"), `en/${slug}`);
  const state = translationState(expected, frontmatterSourceHash(parts.frontmatter));
  if (state === "unstamped") {
    problems.push(`[미스탬프] ko/${slug} — sourceHash 가 없다. \`npm run i18n:stamp\``);
  } else if (state === "stale") stale += 1;
}
for (const slug of onDisk) {
  const parts = splitFrontmatter(readFileSync(pageFile(EN, slug), "utf8"));
  if (parts && frontmatterSourceHash(parts.frontmatter)) {
    problems.push(`[원문에 스탬프] en/${slug} — sourceHash 는 번역본에만 찍는다`);
  }
}

console.log(`선언 ${declared.size} · en ${onDisk.length} · ko ${koSlugs.length} · 크기 예외 ${SIZE_EXCEPTIONS.size}`);
console.log(`번역 진행: ${koSlugs.length}/${onDisk.length} 페이지 · 낡음 ${stale}개 (결함 아님 — 배너가 알린다)`);
console.log();
if (!problems.length) console.log("✅ 문제 없음");
else { console.log(`❌ ${problems.length}건`); for (const p of problems) console.log("  " + p); }
process.exitCode = problems.length ? 1 : 0;
