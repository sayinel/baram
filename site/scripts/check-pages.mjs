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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { GROUPS, groupOf, PAGES, TITLES } from "../ia-tree.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EN = join(HERE, "..", "src/content/docs/en/docs");
const KO = join(HERE, "..", "src/content/docs/ko/docs");

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

/** 그 디렉터리 아래 모든 `.md`/`.mdx` 를 slug 로 (로케일·docs 접두어 제거) */
function slugsOn(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.mdx?$/.test(name)) out.push(relative(dir, p).replace(/\.mdx?$/, ""));
    }
  };
  walk(dir);
  return out;
}

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
  const file = [`${slug}.md`, `${slug}.mdx`].map((f) => join(EN, f)).find(existsSync);
  const raw = readFileSync(file, "utf8");
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
  const file = [`${slug}.md`, `${slug}.mdx`].map((f) => join(EN, f)).find(existsSync);
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

console.log(`선언 ${declared.size} · en ${onDisk.length} · ko ${koSlugs.length} · 크기 예외 ${SIZE_EXCEPTIONS.size}`);
console.log(`번역 진행: ${koSlugs.length}/${onDisk.length} 페이지`);
console.log();
if (!problems.length) console.log("✅ 문제 없음");
else { console.log(`❌ ${problems.length}건`); for (const p of problems) console.log("  " + p); }
process.exitCode = problems.length ? 1 : 0;
