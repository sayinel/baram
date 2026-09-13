#!/usr/bin/env node
// wiki 페이지 게이트. `npm run lint:wiki`
//
// GitHub wiki 자체에는 링크 검증·포맷·리뷰 게이트가 없다. 소스를 리포 안에 두는 이유가
// 그 게이트를 우리가 갖기 위해서이므로, 검사는 여기 있다.
// 규약의 출처는 `.docs/decisions/2026-09-12-vim-wiki-structure.md`.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WIKI = "wiki";
const RESERVED = new Set(["Home.md", "_Sidebar.md", "_Footer.md"]);
const VIM_ROOT = "src/extensions/plugins/vim";
const CODE_MAP = "Vim-Code-map.md";
const BLOB = /https:\/\/github\.com\/sayinel\/baram\/blob\/main\/([^)\s]+)/g;

/** 페이지 길이 예산 (결정 기록의 규칙). 예약 페이지는 목차·푸터라 면제. */
const LINE_FLOOR = 40;
const LINE_CEIL = 200;

/** 길이 예외. `site/scripts/check-pages.mjs` 의 `SIZE_EXCEPTIONS` 와 같은 모양이다 —
 *  예산은 "주제가 둘인가" 를 묻는 장치이지 그 자체가 목적이 아니므로, 정당하게 짧거나
 *  긴 페이지는 **이유와 함께** 여기 적는다. 이유 없이 추가하지 말 것. */
const SIZE_EXCEPTIONS = new Map();

/** 공개 문서 사이트 링크 → `site/` 의 소스 파일. 사용법 라우팅 전체가 이 링크들에 달려 있고,
 *  `site/` 가 페이지를 옮기면 wiki 는 조용히 독자를 404 로 보낸다. 리포 선례: `help-urls.test.ts`
 *  가 `site/help-routes.json` 에서 파생 검증한다. */
const SITE_LINK = /https:\/\/baram\.ing\/([^)\s#]+)/g;

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

// 0. `wiki/` 에 심볼릭 링크 금지.
//    게시 워크플로의 `cp` 는 링크를 **따라간다.** `wiki/X.md` 를 리포 밖이나
//    `$GITHUB_WORKSPACE/.git/config` 로 향하게 만든 PR 이 merge 되면 그 내용이 **공개
//    wiki 에 게시된다.** 워크플로 쪽에서 `persist-credentials: false` 로 가장 값진 표적을
//    없앴지만, 표적을 지우는 것과 경로를 막는 것은 다른 처치다 — 이 검사는 PR 시점에
//    실패시켜, 리뷰어가 diff 에서 심볼릭 링크를 알아보기를 기대하지 않게 한다.
//    **여기서 즉시 중단한다.** 아래 검사들은 페이지를 `readFileSync` 로 읽는데, 그것이
//    곧 링크를 따라가는 일이다 — 위험하다고 판정한 링크를 계속 읽을 이유가 없고, 대상이
//    디렉터리가 아니면 검사가 메시지 대신 스택으로 죽어 원인이 가려진다.
const symlinks = readdirSync(WIKI).filter((e) =>
  lstatSync(join(WIKI, e)).isSymbolicLink(),
);
if (symlinks.length) {
  console.error(`wiki 게이트 실패 (${symlinks.length})`);
  for (const e of symlinks) {
    console.error(`  [심볼릭 링크 금지] ${e} — 게시 시 링크를 따라가 대상이 공개된다`);
  }
  process.exit(1);
}

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

// 3b. `[[Page Name]]` 금지.
//     GitHub wiki 의 **네이티브** 문법이라 기여자가 자연히 손을 뻗고 렌더도 되는데, 대상이
//     없으면 **조용히** 깨진다 — 위의 검사가 이 모양을 아예 보지 못하기 때문이다. 이 wiki 의
//     링크 문법은 `[텍스트](Page-Name)` 하나로 고정하고, 다른 모양은 실패시킨다.
for (const f of files) {
  if (/\[\[/.test(page(f))) {
    problems.push(`[금지된 링크 문법] ${f} — '[[…]]' 대신 '[텍스트](Page-Name)' 을 쓸 것`);
  }
}

// 3c. 페이지 길이 예산.
//     결정 기록이 규칙으로 세웠는데 게이트가 인코딩하지 않으면, "wiki 엔 게이트가 없으니
//     소스를 리포 안에 둔다" 는 이 설계의 논지에 규칙 하나가 빠져 있는 셈이 된다.
for (const f of pages) {
  if (SIZE_EXCEPTIONS.has(f)) continue;
  const n = page(f).split("\n").length;
  if (n < LINE_FLOOR || n > LINE_CEIL) {
    problems.push(
      `[페이지 길이] ${f} — ${n}줄, 예산 ${LINE_FLOOR}~${LINE_CEIL}` +
        ` (정당한 예외면 check-wiki.mjs 의 SIZE_EXCEPTIONS 에 이유와 함께 적을 것)`,
    );
  }
}

// 3e. `wiki/` 는 평평해야 한다.
//     GitHub wiki 에 폴더 계층이 없고 게시도 `cp wiki/*.md` 한 줄이라, 하위 디렉터리에
//     둔 페이지는 **게시되지 않는다.** 그런데 위 검사들은 비재귀 `readdirSync` 라 그것을
//     보지 못하고 초록을 낸다 — 기여자가 페이지를 쓰고 게이트를 통과했는데 wiki 에는
//     없는 상태가 된다. 조용히 버리지 말고 여기서 막는다.
for (const entry of readdirSync(WIKI, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    problems.push(
      `[하위 디렉터리 금지] ${entry.name}/ — wiki 는 평평하다. 계층은 페이지 이름으로 만들 것`,
    );
  }
}

// 3d. 공개 문서 사이트 링크가 실제 페이지를 가리키는가.
//     `site/` 는 별도 npm 프로젝트라 자기 게이트가 있지만, wiki → site 방향은 아무도 안 본다.
for (const f of files) {
  for (const [, path] of page(f).matchAll(SITE_LINK)) {
    const slug = path.replace(/\/$/, "");
    const base = `site/src/content/docs/${slug}`;
    const hit = [".md", ".mdx", "/index.md", "/index.mdx"].some((ext) =>
      existsSync(base + ext),
    );
    if (!hit) problems.push(`[사이트 링크가 없는 페이지를 가리킨다] ${f} → ${path}`);
  }
}

// 4. code map 검증 — 세 티어. 성격이 다른 세 모집단이라 단언도 셋이다.
//
//    `.docs` 가 낡은 방식은 "옮겨진 파일"이 아니라 "추가됐는데 지도에 없는 파일"이었다.
//    그래서 티어 A·B 는 경로 실존만이 아니라 **전수**를 단언한다.
//
//    ‼️ 열거는 `git ls-files` 로 한다 — 디렉터리를 직접 읽으면 추적되지 않는 세션 산출물
//       (`.omc/state/**`)이 vim 디렉터리 안에 섞여 있어 같이 잡힌다. 추적 여부를 기준으로
//       삼으면 제외 목록을 손으로 관리할 필요가 없다.
//
//    ‼️ 범위 주의 — 전수는 **vim 이 통째로 소유한 것에만** 건다:
//       (A) `src/extensions/plugins/vim/**`
//       (B) 그 밖에서 basename 이 vim 인 추적 파일 — **손 목록이 아니라 발견 규칙**이라
//           새 `vim-*.ts` 가 어디 생겨도 잡힌다.
//       지도의 "vim 디렉터리 밖" 절(티어 C)은 **사람이 고른 목록**이라 dangling 만 본다.
//       여기에 전수를 걸 수 없는 이유: 그 파일들이 사는 디렉터리는 vim 소유가 아니고,
//       "vim 이 import 하는 것" 으로 넓히면 **44개**가 잡힌다 — 대부분 toolbar·context
//       menu·tab switching·AI 커맨드처럼 "지금 vim modal 인가"만 묻는 우발적 소비자다.
//       (이 숫자를 남기는 이유: 다음 사람이 반드시 "의존성으로 넓히면 되지 않나"를 다시
//        떠올리고, 근거 없이는 그게 좋은 아이디어로 보인다.)
//       게이트가 못 잡는 결함은 **페이지가 이름 붙여 설명하는 동작의 집이 그 절에 없는 경우**
//       이고, 그건 사람이 본다 — 규칙은 CLAUDE.md 와 지도 그 절의 도입부에 있다.
if (files.includes(CODE_MAP)) {
  const listed = new Set();
  for (const [, p] of page(CODE_MAP).matchAll(BLOB)) listed.add(p);

  // 티어 A·B·C 공통: 지도가 가리키는 경로는 실존해야 한다 (옮겨지면 404).
  for (const p of listed) {
    if (!existsSync(p)) problems.push(`[code map 이 없는 파일을 가리킨다] ${p}`);
  }

  const tracked = (args) =>
    execFileSync("git", ["ls-files", ...args], { encoding: "utf8" })
      .split("\n")
      .filter((p) => p && !p.includes("/__tests__/"));

  // 티어 A — vim 이 통째로 소유한 디렉터리. 새 파일의 기본 착지점이고, 실제 드리프트가
  //          일어난 곳이다.
  for (const p of tracked([VIM_ROOT])) {
    if (!listed.has(p)) problems.push(`[code map 누락 · vim 디렉터리] ${p}`);
  }

  // 티어 B — 그 밖에서 이름이 vim 인 파일. `src/spike/` 는 프로브라 지도의 주제가 아니다.
  const tierB = tracked(["src"]).filter(
    (p) =>
      !p.startsWith(`${VIM_ROOT}/`) &&
      !p.startsWith("src/spike/") &&
      /vim/i.test(p.slice(p.lastIndexOf("/") + 1)),
  );
  for (const p of tierB) {
    if (!listed.has(p)) problems.push(`[code map 누락 · vim 이름 파일] ${p}`);
  }
}

if (problems.length) {
  console.error(`wiki 게이트 실패 (${problems.length})`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`wiki 게이트 통과 — 페이지 ${files.length}`);
