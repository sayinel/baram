#!/usr/bin/env node
// IA 트리 게이트. `npm run site:ia`
// 잡는 것: 누락 · 중복 주장 · 미해결 이름 · 모호(동명 절) · 크기 규칙 위반 · 원문 소진 불일치.
import { measure } from "./ia-measure.mjs";

const { pages, problems, stats } = measure();

console.log(`페이지 ${stats.pageCount}개 · 총 파일 ${stats.fileCount}개`);
console.log(`그룹 ${stats.groups.length}개 · 단독 ${stats.standalone}개`);
console.log(`평균 ${stats.avg}줄 (단축키·신규 페이지 제외, ${stats.sizedCount}개 기준)`);
console.log(
  `원문 소진: 배정 ${stats.assignedLines} + 삭제 ${stats.droppedLines} = ` +
    `${stats.assignedLines + stats.droppedLines} / 원문 ${stats.sourceLines}` +
    (stats.exhausted ? "  ✅" : "  ❌"),
);
console.log(
  `파일 소진: 단위 ${stats.assignedLines} + 절삭제 ${stats.droppedLines} + 머리말 ${stats.preambleAssigned}` +
    `(+버림 ${stats.preambleDropped}) = ${stats.assignedLines + stats.droppedLines + stats.preambleAssigned + stats.preambleDropped}` +
    ` / 파일 ${stats.fileSegments}` + (stats.fileExhausted ? "  ✅" : "  ❌"),
);
if (!stats.fileExhausted) problems.push("[파일 소진 불일치] 머리말까지 세어도 파일 전체와 맞지 않는다");
if (!stats.exhausted) {
  problems.push(`[소진 불일치] ${stats.assignedLines + stats.droppedLines} ≠ ${stats.sourceLines}`);
}

console.log();
if (!problems.length) console.log("✅ 문제 없음");
else {
  console.log(`❌ ${problems.length}건`);
  for (const p of problems) console.log("  " + p);
}

if (process.argv.includes("--sizes")) {
  console.log("\n--- 페이지 줄 수 ---");
  for (const p of pages) {
    console.log(`${String(p.lines ?? "신규").padStart(5)}  ${p.slug}${p.floorException ? "  ⚠️예외" : ""}`);
  }
}

process.exitCode = problems.length ? 1 : 0;
