#!/usr/bin/env node
// 제품 용어 게이트. `npm run check:glossary`
//
// 설계는 "앱과 문서가 같은 기능을 다르게 부르면 안 된다"를 요구한다. 5단계 번역은
// 57페이지 × 여러 PR × 여러 세션이므로 그것을 지키는 것은 사람의 기억이 아니라 이 게이트다.
//
// 두 방향을 본다.
//
//  1. **사전이 앱과 맞는가.** `ko` 를 `appKey` 가 가리키는 앱 i18n 값에서 파생 검증한다.
//     리터럴만 적어 두면 앱이 용어를 바꿀 때 사전만 조용히 낡는다 —
//     "목록을 베낀 문서는 낡는다, 지목한 문서는 안 낡는다"와 같은 형태다.
//
//  2. **번역이 사전과 맞는가.** ko 페이지 본문에 `avoid` 변형이 있으면 실패한다.
//     "반드시 이 말을 쓸 것"은 강제하지 않는다(모든 페이지가 모든 용어를 언급하지 않으므로
//     그런 단정은 공허하다) — 막는 것은 **다르게 부르는 것**이다.
//
// ‼️ 앱의 `src/i18n/ko.json` 을 읽는다. 사이트는 독립 npm 프로젝트지만 이 파일은
//    빌드가 아니라 게이트이고, CI 는 리포 전체를 체크아웃한다. 앱 코드를 import 하지는
//    않는다 — 사전 데이터만 읽는다.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pageFile, slugsOn, TRANSLATION_DIRS } from "./docs-fs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_KO = join(HERE, "..", "..", "src/i18n/ko.json");
const GLOSSARY = join(HERE, "..", "glossary.json");

const problems = [];

const app = JSON.parse(readFileSync(APP_KO, "utf8"));
const { terms } = JSON.parse(readFileSync(GLOSSARY, "utf8"));

// 스캔이 빈손이면 아래 단정이 전부 공허해진다.
if (!Array.isArray(terms) || terms.length < 10) {
  console.error(`❌ glossary.json terms 가 ${terms?.length ?? 0}개 — 형식이 바뀌었다`);
  process.exit(1);
}
if (Object.keys(app).length < 100) {
  console.error(`❌ 앱 사전이 ${Object.keys(app).length}개 — 경로가 바뀌었다`);
  process.exit(1);
}

// ── 1. 사전 ↔ 앱
for (const term of terms) {
  const { appKey, appMode = "equals", appWhy, en, ko } = term;
  if (!en || !ko || !appKey) {
    problems.push(`[항목 불완전] ${JSON.stringify(term).slice(0, 60)} — en·ko·appKey 는 필수다`);
    continue;
  }
  const value = app[appKey];
  if (value === undefined) {
    problems.push(`[없는 앱 키] ${en}: ${appKey} 가 src/i18n/ko.json 에 없다`);
    continue;
  }
  if (appMode === "equals") {
    if (value !== ko) {
      problems.push(`[앱과 다름] ${en}: 사전 "${ko}" ≠ 앱 ${appKey} "${value}"`);
    }
  } else if (appMode === "contains") {
    if (!appWhy) {
      problems.push(`[근거 없음] ${en}: appMode=contains 에는 appWhy 가 필요하다 (정확히 같을 수 없는 이유)`);
    }
    if (!value.includes(ko)) {
      problems.push(`[앱에 없는 말] ${en}: 앱 ${appKey} "${value.slice(0, 40)}" 안에 "${ko}" 가 없다`);
    }
  } else {
    problems.push(`[모르는 appMode] ${en}: "${appMode}"`);
  }
  // canonical 이 avoid 에 들어 있으면 그 용어는 영구히 실패한다.
  if (term.avoid?.some((a) => a === ko)) {
    problems.push(`[자기 부정] ${en}: canonical "${ko}" 가 avoid 에도 있다`);
  }

  // ‼️ **앱이 실제로 쓰는 말은 오역이 아니다.** avoid 목록을 한 앱 키만 보고 지으면
  //    같은 영어 단어가 다른 기능에도 쓰이는 경우(PDF 하이라이트 ↔ 서식 강조)나 앱이
  //    스스로 갈려 있는 경우에 **앱의 어휘를 문서에서 금지**하게 된다. 실제로 그렇게
  //    틀렸다 — `하이라이트` 는 pdfHighlight.* 전체와 settings.markdown.highlight 가
  //    쓰는 말인데 avoid 에 넣어 두었다. 판단이 아니라 앱에서 파생시킨다.
  //    `avoidAnyway` 는 그 판정의 예외다 — 앱이 쓰지만 문서는 그래도 금지하는 말
  //    (앱이 스스로 갈려 있어 문서가 한쪽을 골라야 할 때). 근거를 적어야 한다.
  //
  // ‼️ 이 근거 검사를 `avoid` 순회 **안에** 두었다가 죽은 코드가 됐다 — 면제 항목은
  //    `avoidAnyway` 에 있으니 조건이 영영 참이 되지 않았다. 항목 단위로 옮겼다.
  if (term.avoidAnyway?.length && !term.avoidAnywayWhy) {
    problems.push(`[면제에 근거 없음] ${en}: avoidAnyway 에는 avoidAnywayWhy 가 필요하다`);
  }
  for (const bad of term.avoid ?? []) {
    const used = Object.entries(app).filter(([, v]) => typeof v === "string" && v.includes(bad));
    if (used.length) {
      problems.push(
        `[앱이 쓰는 말을 금지] ${en}: "${bad}" 는 앱이 ${used.length}곳에서 쓴다 ` +
          `(예: ${used[0][0]}) — avoid 에서 빼거나, 앱 쪽이 틀렸다면 avoidAnyway 에 넣고 이유를 적을 것`,
      );
    }
  }
}

/**
 * 문서에서 금지되는 말 전부.
 *
 * ‼️ 두 목록을 **함께** 봐야 한다. 본문 스캔이 `avoid` 만 보고 있었고, 그래서 가장
 *    강제하고 싶던 앱-분기 용어("커맨드 팔레트"·"위키 링크")가 정확히 검사에서
 *    빠져 있었다 — 금지 목록을 둘로 나누면 소비자마다 어느 쪽을 보는지 갈린다.
 */
const forbidden = (term) => [...(term.avoid ?? []), ...(term.avoidAnyway ?? [])];

// ── 2. 번역 ↔ 사전
//
// 코드·URL 은 제외한다. 코드 펜스와 인라인 코드 안의 문자열은 UI 용어가 아니라
// 사용자가 입력하는 리터럴이고, 링크 목적지는 en 페이지를 가리킬 수 있다.
function prose(markdown) {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/\]\([^)]*\)/g, "]");
}

let scanned = 0;
for (const { dir, locale } of TRANSLATION_DIRS) {
  for (const slug of slugsOn(dir)) {
    const text = prose(readFileSync(pageFile(dir, slug), "utf8"));
    scanned += 1;
    for (const term of terms) {
      for (const bad of forbidden(term)) {
        if (text.includes(bad)) {
          problems.push(
            `[용어] ${locale}/${slug}: "${bad}" → "${term.ko}" (${term.en}, 앱 ${term.appKey})`,
          );
        }
      }
    }
  }
}

console.log(`용어 ${terms.length}개 · 앱 키 대조 ${terms.length}건 · 번역 페이지 ${scanned}개 스캔`);
if (!scanned) {
  console.log("ℹ️ 번역 페이지가 없어 본문 스캔은 공허하다 (사전↔앱 대조는 돌았다)");
}
console.log();
if (!problems.length) console.log("✅ 용어 문제 없음");
else { console.log(`❌ ${problems.length}건`); for (const p of problems) console.log("  " + p); }
process.exitCode = problems.length ? 1 : 0;
