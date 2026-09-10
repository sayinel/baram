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
//    정확히 검사 밖이었다. 코드 펜스도 그랬다: 펜스 안이라고 다 사용자가 입력하는
//    리터럴이 아니고 **읽는 산문**이 섞인다(`plugin-dev/quick-start` 의 프로젝트 트리는
//    주석이 한국어다). 지금은 프론트매터의 사람이 읽는 필드와 펜스를 모두 본다.
//    새어 나간 세 번째·네 번째는 **페이지 밖에 있는 번역문**이다. (3) 사이드바 그룹
//    이름은 `ia-tree.mjs` 에 있어서 안 보였고 `Vault와 작업 공간` 이 금지 변형
//    (`작업 공간`)과 requireKo 위반(`Vault`)을 동시에 갖고 배포돼 있었다. (4) **한국어
//    랜딩 전체**(`src/i18n/ko.json`, 89키)도 안 보였고 위반 **6건**이 살아 있었다 —
//    `Vault & 퍼스펙티브` 는 (3)을 고치게 만든 것과 정확히 같은 짝이었다.
//    ‼️ 그러니 "스캔이 넓어졌다" 를 주장으로 적지 말 것. 이 목록에 **무엇이 들어 있는지**로
//       적고, 새로 번역되는 표면이 생기면 그때 이 목록에 더한다.
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

import { GROUPS } from "../ia-tree.mjs";
import { translationLocales } from "../routes.mjs";
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

/**
 * 항목이 가질 수 있는 필드 전부.
 *
 * ‼️ 닫힌 집합인 이유: 이 스크립트는 없는 필드를 **조용히 무시**한다. `alsoKeys` 를
 * `alsokeys` 로 적으면 검사 하나가 사라지고 게이트는 초록으로 남는다 — 요약줄의 숫자만
 * 조용히 줄어든다. 오타를 숫자로 알아채길 기대하지 말고 실패시킨다.
 * `avoidAnyway`·`requireKoAnywayWhy` 는 지금 쓰는 항목이 없지만 **문서화된 탈출구**다
 * (앱이 정당하게 다르게 부를 때) — 아래 검사들이 그것을 계속 읽으므로 목록에 남긴다.
 */
const TERM_FIELDS = new Set([
  "alsoKeys",
  "appKey",
  "appMode",
  "appWhy",
  "avoid",
  "avoidAnyway",
  "avoidAnywayWhy",
  "avoidIn",
  "en",
  "ko",
  "note",
  "requireKo",
  "requireKoAnywayWhy",
  "requireKoAppExempt",
]);

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
  for (const field of Object.keys(term)) {
    if (!TERM_FIELDS.has(field)) {
      problems.push(`[모르는 필드] ${en ?? "?"}: "${field}" — 오타인가, TERM_FIELDS 에 더할 것인가`);
    }
  }
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

  // ‼️ 같은 기능을 부르는 **다른 앱 키**도 같은 말을 쓰는가.
  //    `avoid` 는 앱 전체에서 금지 표기를 찾으므로 앱이 갈라지는 것을 이미 잡는다 — 단
  //    동형이의어에는 `avoid` 를 둘 수 없다(`Highlight`: 서식 마크 ↔ PDF 주석). 그때
  //    갈라짐을 잡는 것은 이 목록뿐이다. 실제로 `settings.markdown.highlight` 만
  //    PDF 쪽 말('하이라이트')을 쓰고 있었고, 그 표면만 조용히 다른 기능처럼 보였다.
  //    리터럴이 아니라 canonical `ko` 에서 파생 검증하므로 용어가 바뀌면 함께 움직인다.
  if (term.alsoKeys !== undefined) {
    if (!Array.isArray(term.alsoKeys) || term.alsoKeys.length === 0) {
      problems.push(`[빈 alsoKeys] ${en}: 지목할 키가 없으면 필드를 빼라`);
    }
    for (const key of term.alsoKeys ?? []) {
      const other = app[key];
      if (other === undefined) {
        problems.push(`[없는 앱 키] ${en}: alsoKeys 의 ${key} 가 src/i18n/ko.json 에 없다`);
        // `usedAsWord` 는 미포함도 false 로 돌린다 — `!other.includes(ko) ||` 를 앞에
        // 두면 어떤 판정도 바꾸지 않는 죽은 절이 된다(변형 테스트로 확인).
      } else if (!usedAsWord(other, ko)) {
        problems.push(
          `[같은 기능을 다르게 부른다] ${en}: ${key} = "${other.slice(0, 40)}" 안에 ` +
            `canonical "${ko}" 가 낱말로 없다 — ${appKey} 와 같은 말을 써야 한다`,
        );
      }
    }
  }

  // ‼️ `alsoKeys` 는 canonical 의 **존재**만 본다 — 그 값이 canonical 과 다른 기능의
  //    말을 **동시에** 가져도 통과한다. 실측으로 확인했다: `.desc` 를
  //    `==강조== 구문 활성화 (하이라이트 마크)` 로 바꾸면 게이트가 초록이었다.
  //    동형이의어에는 `avoid`(앱 전체 금지)를 쓸 수 없으니 그 부재를 볼 검사가 어디에도
  //    없었다. `avoidIn` 은 **`appKey` ∪ `alsoKeys` 의 값 안에서만** 금지한다 — 키 집합이
  //    열거돼 있으므로 같은 영어 낱말을 쓰는 다른 기능(PDF 주석)의 어휘는 건드리지 않는다.
  if (term.avoidIn !== undefined) {
    if (!Array.isArray(term.avoidIn) || term.avoidIn.length === 0) {
      problems.push(`[빈 avoidIn] ${en}: 금지할 말이 없으면 필드를 빼라`);
    }
    for (const bad of term.avoidIn ?? []) {
      if (ko.includes(bad)) {
        problems.push(`[자기 부정] ${en}: canonical "${ko}" 가 avoidIn "${bad}" 를 포함한다`);
      }
      for (const key of [appKey, ...(term.alsoKeys ?? [])]) {
        const value = app[key];
        if (value !== undefined && value.includes(bad)) {
          problems.push(
            `[다른 기능의 말이 섞였다] ${en}: ${key} = "${value.slice(0, 40)}" 가 ` +
              `"${bad}" 를 쓴다 — 이 키 집합은 "${ko}" 만 쓴다`,
          );
        }
      }
    }
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
  // ‼️ `requireKo` 는 "영어형이 남아 있으면 번역을 빼먹은 것" 이라고 가정한다. 그런데
  //    **앱 자신이 영어로 부르는 것**이면 그 가정이 거짓이다 — `Zettel` 이 그랬다: 앱은
  //    공간·분류를 영어 `Zettel` 로, 노트를 `제텔` 로 부른다. 그래서 "Zettel 허브" 라는
  //    옳은 문장이 걸렸다. 이것도 판단이 아니라 앱에서 파생시킨다.
  //    ‼️ `requireKoAnywayWhy` 하나만 두면 이 검사가 **전면 억제**된다 — 정당한 영어형
  //    한 곳 때문에 나머지 전부가 무검사가 된다. `Journal` 이 그 함정을 드러냈다: 앱의
  //    정당한 영어형은 `journal.outsideCreate` 의 `[[Journal::{date}]]`(위키링크 **문법**
  //    리터럴) 하나뿐인데, 그것 때문에 억제를 걸면 `space.journal.directoryTaken` 의
  //    "Journal 디렉터리"(진짜 오역, main 이 머지로 들여왔다)가 그 그늘에 숨었다.
  //    그래서 면제는 **키 단위**다: 열거한 키만 빠지고 나머지는 계속 검사받는다.
  if (term.requireKo) {
    const enWord = new RegExp(`(^|[^A-Za-z])${en}([^A-Za-z]|$)`);
    const exempt = new Set(term.requireKoAppExempt ?? []);
    const inApp = Object.entries(app).filter(([, v]) => typeof v === "string" && enWord.test(v));

    if (exempt.size && !term.requireKoAnywayWhy) {
      problems.push(`[면제에 근거 없음] ${en}: requireKoAppExempt 에는 requireKoAnywayWhy 가 필요하다`);
    }
    // 면제 목록은 낡는다. 그 키가 더는 영어형을 담지 않으면 목록이 조용히 넓어진 것이다.
    for (const key of exempt) {
      const v = app[key];
      if (typeof v !== "string" || !enWord.test(v)) {
        problems.push(
          `[낡은 면제] ${en}: requireKoAppExempt 의 "${key}" 는 이제 "${en}" 을 담지 않는다 — 목록에서 뺄 것`,
        );
      }
    }

    const unexplained = inApp.filter(([k]) => !exempt.has(k));
    if (unexplained.length && !term.requireKoAnywayWhy) {
      problems.push(
        `[영어형을 앱이 쓴다] ${en}: 앱이 ${unexplained.length}곳에서 영어 그대로 쓴다 ` +
          `(예: ${unexplained[0][0]} = "${unexplained[0][1].slice(0, 24)}") — requireKo 를 빼거나, ` +
          `정당한 자리는 requireKoAppExempt 에 키로 열거하고 근거를 requireKoAnywayWhy 에 적을 것`,
      );
    } else if (unexplained.length && exempt.size) {
      // 면제 목록이 있는데 그 밖에서 영어형이 나왔다 — 억제가 아니라 발견이다.
      problems.push(
        `[면제 밖의 영어형] ${en}: ${unexplained.map(([k]) => k).join(", ")} — ` +
          `오역이면 "${term.ko}" 로 고치고, 정당하면 requireKoAppExempt 에 더할 것`,
      );
    }
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
//
// 스캔 대상은 **사용자가 읽는 번역된 문자열 전부**다 — 페이지 본문과, 페이지 밖에 있는
// UI 라벨. 둘을 한 목록으로 모아 같은 판정을 걸어야 한쪽만 검사받는 일이 없다.
const pages = TRANSLATION_DIRS.flatMap(({ dir, locale }) =>
  slugsOn(dir).map((slug) => ({
    name: `${locale}/${slug}`,
    text: scannable(readFileSync(pageFile(dir, slug), "utf8")),
  })),
);

// 사이드바 그룹 라벨. 문서 홈의 주제 카드도 같은 값을 쓰므로(DocsHome.astro) 이 라벨
// 하나가 사이드바와 카드 두 곳에 뜬다.
const labels = Object.entries(GROUPS).flatMap(([key, byLocale]) =>
  translationLocales().flatMap((locale) =>
    byLocale[locale] ? [{ name: `ia-tree.mjs GROUPS.${key}.${locale}`, text: byLocale[locale] }] : [],
  ),
);

// 사이트 자신의 랜딩 문자열. 페이지도 아니고 IA 라벨도 아니라 두 목록 어디에도 없었다.
const landing = translationLocales().flatMap((locale) => {
  const file = join(HERE, "..", "src/i18n", `${locale}.json`);
  return Object.entries(JSON.parse(readFileSync(file, "utf8")))
    .filter(([, value]) => typeof value === "string")
    .map(([key, value]) => ({ name: `src/i18n/${locale}.json ${key}`, text: value }));
});

for (const { name, text } of [...pages, ...labels, ...landing]) {
  for (const term of terms) {
    for (const bad of forbidden(term)) {
      if (text.includes(bad)) {
        problems.push(`[용어] ${name}: "${bad}" → "${term.ko}" (${term.en}, 앱 ${term.appKey})`);
      }
    }
    // 영어를 그대로 둔 것. 금지 목록은 부재를 못 잡는다.
    if (term.requireKo) {
      const left = new RegExp(`(^|[^A-Za-z])${term.en}([^A-Za-z]|$)`).test(text);
      if (left && !text.includes(term.ko)) {
        problems.push(`[영어 그대로] ${name}: "${term.en}" 를 두고 "${term.ko}" 가 없다`);
      }
    }
  }
}

// ‼️ 라벨은 **개수를 파생시켜 소진을 단정한다.** 개수만 세면 `ko: ""` 로 빈 문자열을 둔
//    그룹이 스캔에서 조용히 빠지는데(`byLocale[locale]` 이 falsy) 총계는 11개로 여전히
//    0보다 크므로 통과한다 — 그 그룹은 사이드바와 주제 카드에 **빈 이름**으로 뜬다.
//    (완전히 없는 키는 Starlight 의 zod 가 `astro sync` 에서 걸지만 메시지가 엉뚱하다.)
const expectedLabels = Object.keys(GROUPS).length * translationLocales().length;
if (labels.length !== expectedLabels) {
  problems.push(
    `[라벨 누락] 번역된 그룹 라벨이 ${labels.length}개 — GROUPS ${Object.keys(GROUPS).length}개 × ` +
      `번역 로케일 ${translationLocales().length}개 = ${expectedLabels}개여야 한다. 빈 문자열이나 없는 키를 찾을 것`,
  );
}

const enforced = terms.filter((t) => forbidden(t).length || t.requireKo).length;
// 항목마다 appKey 하나 + alsoKeys — 리터럴 33 이 아니라 실제로 대조한 키 수를 적는다.
const appKeyChecks = terms.reduce((n, t) => n + 1 + (t.alsoKeys?.length ?? 0), 0);
console.log(
  `용어 ${terms.length}개 · 앱 키 대조 ${appKeyChecks}건 · 본문에서 강제 ${enforced}개 · ` +
    `번역 페이지 ${pages.length}개 · UI 라벨 ${labels.length}개 · 랜딩 문자열 ${landing.length}개 스캔`,
);
// ‼️ 열린 채 실패하면 안 된다. 로케일 설정이 흔들리면 스캔 전체가 공허해지는데 종료
//    코드는 0이 된다 — 신선도 판정이 조용히 꺼지는 것과 같은 형태다.
//    **두 부류를 따로 센다.** 합계만 보면 라벨이 0이 돼도 페이지 57개가 그것을 가린다.
if (!pages.length) {
  console.error("❌ 번역 페이지를 하나도 못 찾았습니다 — 본문 스캔이 공허하다 (경로·로케일 설정 확인)");
  process.exit(1);
}
if (!labels.length) {
  console.error("❌ 번역된 UI 라벨을 하나도 못 찾았습니다 — ia-tree.mjs 의 GROUPS 모양을 확인하십시오");
  process.exit(1);
}
if (!landing.length) {
  console.error("❌ 번역된 랜딩 문자열을 하나도 못 찾았습니다 — src/i18n/<locale>.json 을 확인하십시오");
  process.exit(1);
}
console.log();
if (!problems.length) console.log("✅ 용어 문제 없음");
else { console.log(`❌ ${problems.length}건`); for (const p of problems) console.log("  " + p); }
process.exitCode = problems.length ? 1 : 0;
