#!/usr/bin/env node
// wiki 페이지 게이트. `npm run lint:wiki`
//
// GitHub wiki 자체에는 링크 검증·포맷·리뷰 게이트가 없다. 소스를 리포 안에 두는 이유가
// 그 게이트를 우리가 갖기 위해서이므로, 검사는 여기 있다.
// 규약의 출처는 `.docs/decisions/2026-09-12-vim-wiki-structure.md`.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WIKI = "wiki";
const RESERVED = new Set(["Home.md", "_Sidebar.md", "_Footer.md"]);
const VIM_ROOT = "src/extensions/plugins/vim";
const CODE_MAP = "Vim-Code-map.md";
const BLOB = /https:\/\/github\.com\/sayinel\/baram\/blob\/main\/([^)\s]+)/g;

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

// 3. 내부 링크 — 사이드바는 위에서 이미 봤으므로 제외한다 (중복 보고 방지)
for (const f of files) {
  if (f === "_Sidebar.md") continue;
  for (const [, target] of page(f).matchAll(WIKI_LINK)) {
    if (!files.includes(`${target}.md`)) {
      problems.push(`[깨진 내부 링크] ${f} → ${target}`);
    }
  }
}

// 4. code map 전수 검증
//    `.docs` 가 낡은 방식은 "옮겨진 파일"이 아니라 "추가됐는데 지도에 없는 파일"이었다.
//    그래서 경로 실존만이 아니라 **전수**를 단언한다.
//
//    ‼️ 열거는 `git ls-files` 로 한다 — 디렉터리를 직접 읽으면 추적되지 않는 세션 산출물
//       (`.omc/state/**`)이 vim 디렉터리 안에 섞여 있어 같이 잡힌다. 추적 여부를 기준으로
//       삼으면 제외 목록을 손으로 관리할 필요가 없다.
if (files.includes(CODE_MAP)) {
  const listed = new Set();
  for (const [, p] of page(CODE_MAP).matchAll(BLOB)) listed.add(p);

  for (const p of listed) {
    if (!existsSync(p)) problems.push(`[code map 이 없는 파일을 가리킨다] ${p}`);
  }

  const tracked = execFileSync("git", ["ls-files", VIM_ROOT], { encoding: "utf8" })
    .split("\n")
    .filter((p) => p && !p.includes("/__tests__/"));
  for (const p of tracked) {
    if (!listed.has(p)) problems.push(`[code map 누락] ${p}`);
  }
}

if (problems.length) {
  console.error(`wiki 게이트 실패 (${problems.length})`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`wiki 게이트 통과 — 페이지 ${files.length}`);
