#!/usr/bin/env node
// 제품 용어 게이트. `npm run check:glossary`
//
// 설계는 "앱과 문서가 같은 기능을 다르게 부르면 안 된다"를 요구한다. 5단계 번역은
// 57페이지 × 여러 PR × 여러 세션이므로 그것을 지키는 것은 사람의 기억이 아니라 이 게이트다.
//
// 네 방향을 본다.
//
//  1. **사전이 앱과 맞는가.** `ko` 를 `appKey` 가 가리키는 앱 i18n 값에서 파생 검증한다.
//     리터럴만 적어 두면 앱이 용어를 바꿀 때 사전만 조용히 낡는다.
//  2. **avoid 후보가 정말 오역인가.** 앱이 실제로 쓰는 말은 오역이 아니다.
//  3. **번역이 다르게 부르지 않는가.** 금지 변형이 ko 본문에 있으면 실패한다.
//  4. **영어를 그대로 두지 않았는가.** ko 본문에 영어 용어가 있으면 한국어도 있어야 한다.
//     (3)은 **부재**를 못 잡는다 — 번역을 빼먹은 것이 가장 흔한 실제 불일치다.
//
// ‼️ **스캔 범위가 이 게이트의 전부다.** 한 번 좁게 잡았다가 프론트매터의 `title` 이
//    빠졌다 — 그 페이지에서 가장 눈에 띄는 문자열(h1·사이드바 라벨·브라우저 탭·meta)이
//    정확히 검사 밖이었다. 코드 펜스도 그랬다: `getting-started` 의 3열 화면 도해는 펜스
//    안이지만 사용자가 입력하는 리터럴이 아니라 **읽는 산문**이고, 패널 이름이 한자리에
//    모여 있는 곳이다. 지금은 프론트매터의 사람이 읽는 필드와 펜스를 모두 본다.
//
// ‼️ 이 게이트는 열거된 금지 목록이다 — 열린 집합을 덮지 못한다. `작업`(Task)·
//    `저장소`(Vault) 처럼 가장 그럴듯한 오역이 앱의 다른 기능 어휘라서 금지할 수 없다.
//    (4)의 조건부 검사가 그 구멍의 한쪽(영어를 그대로 둔 것)을 메운다.
//
// ‼️ 앱의 `src/i18n/ko.json` 을 읽는다. 그 파일은 `pages.yml` 의 path 필터에도 있어야
//    한다 — 없으면 앱이 용어를 바꿀 때 이 게이트가 **돌지 않는다**.
//    `tests/workflow-inputs.test.mjs` 가 그 결합을 게이트 소스에서 파생시킨다.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pageFile, slugsOn, TRANSLATION_DIRS } from "./docs-fs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_KO = join(HERE, "..", "..", "src/i18n/ko.json");
const GLOSSARY = join(HERE, "..", "glossary.json");

/** 사람이 읽는 프론트매터 필드. `sourceHash` 같은 기계 필드는 스캔하지 않는다. */
const PROSE_FIELDS = ["title", "description"];

/**
 * 한국어 명사 뒤에 붙을 수 있는 것 — 조사.
 *
 * `appMode: "contains"` 의 절단 구멍을 막는다. `"태스크 입력…".includes("태")` 가 참이라
 * canonical 을 `태` 로 줄여도 통과했다(실측). 실행 중인 문장에서 명사 뒤에는 공백·부호나
 * **조사**가 오지, 그 명사의 나머지 글자가 오지 않는다.
 */
const PARTICLES = [
  "에서", "으로", "이나", "라도",
  "에", "를", "을", "이", "가", "는", "은", "의", "로", "와", "과", "도", "만", "부터", "까지",
];

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

/** 앱 값 안에서 `ko` 가 **온전한 낱말**로 쓰였는가. */
function usedAsWord(value, ko) {
  let from = 0;
  for (;;) {
    const at = value.indexOf(ko, from);
    if (at < 0) return false;
    const tail = value.slice(at + ko.length);
    if (tail === "" || !/^[가-힣]/.test(tail) || PARTICLES.some((p) => tail.startsWith(p))) {
      return true;
    }
    from = at + 1;
  }
}

// ── 1·2. 사전 ↔ 앱
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
      problems.push(`[근거 없음] ${en}: appMode=contains 에는 appWhy 가 필요하다`);
    }
    if (!value.includes(ko)) {
      problems.push(`[앱에 없는 말] ${en}: 앱 ${appKey} "${value.slice(0, 40)}" 안에 "${ko}" 가 없다`);
    } else if (!usedAsWord(value, ko)) {
      problems.push(
        `[낱말이 아니다] ${en}: 앱 ${appKey} "${value.slice(0, 40)}" 안에서 "${ko}" 뒤에 ` +
          `그 낱말의 나머지 글자가 온다 — canonical 이 잘린 것 아닌가`,
      );
    }
  } else {
    problems.push(`[모르는 appMode] ${en}: "${appMode}"`);
  }

  // canonical 을 스스로 금지하면 그 용어는 영구히 실패하거나 옳은 페이지를 잘못 신고한다.
  // ‼️ 정확히 같은 경우만 보다가 부분 문자열을 놓쳤다 — `위키` 를 금지하면 `위키링크` 를
  //    쓴 페이지가 "위키링크 → 위키링크" 로 바꾸라는 메시지와 함께 걸린다(실측).
  for (const bad of [...(term.avoid ?? []), ...(term.avoidAnyway ?? [])]) {
    if (ko.includes(bad)) {
      problems.push(`[자기 부정] ${en}: canonical "${ko}" 가 금지어 "${bad}" 를 포함한다`);
    }
  }

  // ‼️ **앱이 실제로 쓰는 말은 오역이 아니다.** avoid 를 한 앱 키만 보고 지으면, 같은
  //    영어 단어가 다른 기능에도 쓰이거나(PDF 하이라이트 ↔ 서식 강조) 앱이 스스로 갈려
  //    있을 때 **앱의 어휘를 문서에서 금지**하게 된다. 실제로 30개 중 4개가 그랬다.
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

/** 문서에서 금지되는 말 전부. 두 목록을 나눠 보면 소비자마다 어느 쪽을 보는지 갈린다. */
const forbidden = (term) => [...(term.avoid ?? []), ...(term.avoidAnyway ?? [])];

/**
 * 스캔 대상 — 사람이 읽는 것 전부.
 *
 * 프론트매터에서는 `PROSE_FIELDS` 만 꺼낸다. 본문은 **코드 펜스를 포함**한다(도해가
 * 그 안에 있다). 제외하는 것은 인라인 코드와 링크 목적지뿐이다 — 전자는 사용자가
 * 입력하는 리터럴이고 후자는 en 페이지를 가리킬 수 있다.
 */
function scannable(markdown) {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  const head = fm
    ? PROSE_FIELDS.flatMap((field) => {
        const m = new RegExp(`^${field}:[ \\t]*(.+?)[ \\t]*$`, "m").exec(fm[1]);
        return m ? [m[1]] : [];
      }).join("\n")
    : "";
  const body = (fm ? markdown.slice(fm[0].length) : markdown)
    .replace(/`[^`\n]*`/g, "")
    .replace(/\]\([^)]*\)/g, "]");
  return `${head}\n${body}`;
}

// ── 3·4. 번역 ↔ 사전
let scanned = 0;
for (const { dir, locale } of TRANSLATION_DIRS) {
  for (const slug of slugsOn(dir)) {
    const text = scannable(readFileSync(pageFile(dir, slug), "utf8"));
    scanned += 1;
    for (const term of terms) {
      for (const bad of forbidden(term)) {
        if (text.includes(bad)) {
          problems.push(
            `[용어] ${locale}/${slug}: "${bad}" → "${term.ko}" (${term.en}, 앱 ${term.appKey})`,
          );
        }
      }
      // 영어를 그대로 둔 것. 금지 목록은 부재를 못 잡는다.
      if (term.requireKo) {
        const left = new RegExp(`(^|[^A-Za-z])${term.en}([^A-Za-z]|$)`).test(text);
        if (left && !text.includes(term.ko)) {
          problems.push(
            `[영어 그대로] ${locale}/${slug}: "${term.en}" 를 두고 "${term.ko}" 가 없다`,
          );
        }
      }
    }
  }
}

const enforced = terms.filter((t) => forbidden(t).length || t.requireKo).length;
console.log(
  `용어 ${terms.length}개 · 앱 키 대조 ${terms.length}건 · ` +
    `본문에서 강제 ${enforced}개 · 번역 페이지 ${scanned}개 스캔`,
);
// ‼️ 열린 채 실패하면 안 된다. 로케일 설정이 흔들리면 본문 스캔 전체가 공허해지는데
//    종료 코드는 0이 된다 — 신선도 판정이 조용히 꺼지는 것과 같은 형태다.
if (!scanned) {
  console.error("❌ 번역 페이지를 하나도 못 찾았습니다 — 본문 스캔이 공허하다 (경로·로케일 설정 확인)");
  process.exit(1);
}
console.log();
if (!problems.length) console.log("✅ 용어 문제 없음");
else { console.log(`❌ ${problems.length}건`); for (const p of problems) console.log("  " + p); }
process.exitCode = problems.length ? 1 : 0;
