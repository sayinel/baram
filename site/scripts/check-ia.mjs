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
