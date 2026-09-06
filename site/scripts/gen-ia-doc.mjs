#!/usr/bin/env node
// IA 문서의 트리 표를 매니페스트에서 생성한다. `node site/scripts/gen-ia-doc.mjs`
//
// ‼️ 트리를 문서에 손으로 베껴 쓰면 낡는다 — 첫 판에서 실제로 줄 수 12곳이 틀렸다.
//    canonical은 site/ia-tree.mjs이고 이 스크립트가 문서를 거기에 맞춘다.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GROUPS } from "../ia-tree.mjs";
import { CEIL, FLOOR, measure, parseHeadings } from "./ia-measure.mjs";

const DOC = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../dev/design/specs/2026-09-06-docs-site-ia-tree.md",
);
const BEGIN = "<!-- BEGIN generated tree — site/scripts/gen-ia-doc.mjs 가 씁니다. 손으로 고치지 마세요 -->";
const END = "<!-- END generated tree -->";

const SRC_LABEL = {
  "docs/user-guide.md": "user-guide",
  "docs/plugin-development.md": "plugin-development",
  "docs/faq.md": "faq",
  "docs/keyboard-shortcuts.md": "keyboard-shortcuts",
};

/**
 * 페이지가 가져가는 절을 "이름 줄수" 목록으로 — 출처를 사람이 검증할 수 있게.
 *
 * H2는 두 종류를 구분해 적는다. 자식 H3가 있으면 그 단위는 **도입부만**이고,
 * 없으면 절 전체다. 뭉개면 `Overview` 25줄이 "도입부 25줄"로 잘못 읽힌다.
 * 동명 H3는 부모를 앞에 붙인다 — `Setup` 셋을 구분할 방법이 그것뿐이다.
 */
function sourceCell(page, docFacts) {
  if (page.synthetic) return "**새로 쓴다.** 그룹 안내 + 진입 경로. 원문에 대응물 없음";
  if (page.wholeDoc) return `\`${SRC_LABEL[page.src]}.md\` 통째 — 분할하지 않는다`;
  const { parents, duplicated } = docFacts.get(page.src);
  return page.units
    .map((u) => {
      if (u.level === 2) {
        return parents.has(u.text) ? `_${u.text}_ 도입부 ${u.span}` : `_${u.text}_ ${u.span}`;
      }
      return duplicated.has(u.text) ? `${u.parent} → ${u.text} ${u.span}` : `${u.text} ${u.span}`;
    })
    .join(" · ");
}

/** 문서마다: 자식을 가진 H2 이름 집합, 이름이 둘 이상인 H3 텍스트 집합 */
function factsFor(sources) {
  const facts = new Map();
  for (const src of sources) {
    const units = parseHeadings(src);
    const seen = new Map();
    for (const u of units) if (u.level === 3) seen.set(u.text, (seen.get(u.text) ?? 0) + 1);
    facts.set(src, {
      parents: new Set(units.filter((u) => u.level === 3).map((u) => u.parent)),
      duplicated: new Set([...seen].filter(([, n]) => n > 1).map(([t]) => t)),
    });
  }
  return facts;
}

const { pages, problems, stats } = measure();
if (problems.length) {
  console.error(`❌ IA에 문제 ${problems.length}건 — 문서를 생성하지 않습니다. \`npm run site:ia\`로 확인하세요.`);
  process.exit(1);
}

const lines = [];
lines.push(`| | 값 |`, `| --- | ---: |`);
lines.push(`| 페이지 / 로케일 | **${stats.pageCount}** |`);
lines.push(`| 총 파일 (en + ko) | **${stats.fileCount}** |`);
lines.push(`| 사이드바 최상위 항목 | ${stats.groups.length + stats.standalone} (그룹 ${stats.groups.length} + 단독 ${stats.standalone}) |`);
lines.push(`| 평균 줄 | ${stats.avg} (${stats.sizedCount}개 기준 — 단축키·신규 제외) |`);
lines.push(`| 원문 소진 | 배정 ${stats.assignedLines} + 삭제 ${stats.droppedLines} = ${stats.sourceLines} ✅ |`);
lines.push("");

const docFacts = factsFor(new Set(pages.filter((p) => p.src).map((p) => p.src)));

// 사이드바 순서를 그대로 보존한다 — 단독 페이지는 그룹들 사이에 끼어 있고 그 위치가 정보다.
// 단독 항목은 slug로 제목을 달아 "단독 페이지" 헤딩이 여러 번 반복되지 않게 한다.
let current = Symbol("none");
for (const page of pages) {
  const sameRun = page.group !== null && page.group === current;
  if (!sameRun) {
    current = page.group;
    const heading = page.group
      ? `### ${GROUPS[page.group].ko} \`${page.group}/\` (${pages.filter((p) => p.group === page.group).length})`
      : `### 단독 — \`${page.slug}\``;
    lines.push("", heading, "");
    lines.push(`| slug | 줄 | 출처 |`, `| --- | ---: | --- |`);
  }
  const size = page.lines === null ? "신규" : `${page.lines}${page.floorException ? " ⚠️" : ""}`;
  lines.push(`| \`${page.slug}\` | ${size} | ${sourceCell(page, docFacts)} |`);
}

const exceptions = pages.filter((p) => p.floorException);
lines.push(
  "",
  `### 크기 규칙 예외 (${exceptions.length}건)`,
  "",
  `하한 ${FLOOR}줄 · 상한 ${CEIL}줄이 규칙이다. 아래만이 승인된 예외이며, 그 밖의 위반은 \`npm run site:ia\`가 실패시킨다.`,
  "",
  `| slug | 줄 | 병합하지 않는 이유 |`,
  `| --- | ---: | --- |`,
);
const WHY = {
  "editing/source-mode-and-find":
    "유일한 병합 대상이 `slash-commands-and-toolbars`인데 성격이 무관하다",
  "versioning/git":
    "유일한 병합 대상이 파일 스냅샷인데 **Git과 스냅샷은 서로 다른 버전 관리 시스템**이라 한 페이지에 넣으면 독자가 혼동한다 — 짧은 페이지가 잘못된 개념 통합보다 낫다",
};
for (const p of exceptions) {
  lines.push(`| \`${p.slug}\` | ${p.lines} | ${WHY[p.slug] ?? "**이유 미기재 — 채울 것**"} |`);
}

const doc = readFileSync(DOC, "utf8");
const before = doc.indexOf(BEGIN);
const after = doc.indexOf(END);
if (before === -1 || after === -1) {
  console.error(`❌ ${DOC} 에 생성 구간 표시가 없습니다.`);
  process.exit(1);
}
writeFileSync(
  DOC,
  doc.slice(0, before + BEGIN.length) + "\n" + lines.join("\n") + "\n" + doc.slice(after),
);
console.log(`✅ 트리 표 생성 — 페이지 ${stats.pageCount}개, 예외 ${exceptions.length}건`);
