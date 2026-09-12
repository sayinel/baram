#!/usr/bin/env node
// wiki 페이지 게이트. `npm run lint:wiki`
//
// GitHub wiki 자체에는 링크 검증·포맷·리뷰 게이트가 없다. 소스를 리포 안에 두는 이유가
// 그 게이트를 우리가 갖기 위해서이므로, 검사는 여기 있다.
// 규약의 출처는 `.docs/decisions/2026-09-12-vim-wiki-structure.md`.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WIKI = "wiki";
const RESERVED = new Set(["Home.md", "_Sidebar.md", "_Footer.md"]);

/** 제목 `Vim Architecture` → 파일 `Vim-Architecture.md`. GitHub wiki 는 제목에
 *  슬래시·콜론 등을 금지하고 폴더로 계층을 만들 수 없다 — 이름이 곧 계층이다. */
const PAGE_NAME = /^[A-Z][A-Za-z0-9]*(-[A-Za-z0-9]+)*\.md$/;

/** 페이지 안 wiki 링크: `[텍스트](Vim-Architecture)`. 확장자 없이 쓴다 — 독자는 게시된
 *  wiki 이고 `/wiki/Vim-Architecture.md` 는 404 다. 외부 URL·앵커 전용은 제외. */
const WIKI_LINK = /\[[^\]]*\]\((?!https?:|#|mailto:)([^)#\s]+)(?:#[^)]*)?\)/g;

const problems = [];
const page = (f) => readFileSync(join(WIKI, f), "utf8");

const files = readdirSync(WIKI)
  .filter((f) => f.endsWith(".md"))
  .sort();
const pages = files.filter((f) => !RESERVED.has(f));

// 1. 필수 페이지와 이름 규약
for (const f of RESERVED) {
  if (!files.includes(f)) problems.push(`[필수 페이지 없음] ${f}`);
}
for (const f of pages) {
  if (!PAGE_NAME.test(f)) {
    problems.push(`[이름 규약 위반] ${f} — 'Vim-Architecture.md' 꼴이어야 한다`);
  }
}

// 2. 사이드바 ↔ 디스크 (양방향)
//    사이드바의 **링크**만 페이지를 가리킨다. 아직 안 쓴 페이지는 링크가 아닌 평문으로
//    둔다 — 그래야 빈 페이지를 만들지 않고도 목차에 자리를 남긴다.
const linked = new Set();
if (files.includes("_Sidebar.md")) {
  for (const [, target] of page("_Sidebar.md").matchAll(WIKI_LINK)) {
    linked.add(`${target}.md`);
  }
  for (const target of linked) {
    if (!files.includes(target)) {
      problems.push(`[사이드바가 없는 페이지를 가리킨다] ${target.replace(/\.md$/, "")}`);
    }
  }
  for (const f of pages) {
    if (!linked.has(f)) {
      problems.push(`[사이드바 미등재] ${f} — _Sidebar.md 에 링크를 더할 것`);
    }
  }
}

if (problems.length) {
  console.error(`wiki 게이트 실패 (${problems.length})`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`wiki 게이트 통과 — 페이지 ${files.length}`);
