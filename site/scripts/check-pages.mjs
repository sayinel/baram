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
import { readFileSync } from "node:fs";
import { GROUPS, groupOf, PAGES, TITLES } from "../ia-tree.mjs";
import {
  frontmatterSourceHash,
  hashSourceFile,
  splitFrontmatter,
  translationState,
  SOURCE_HASH_LENGTH,
} from "../src/lib/source-hash.ts";
import { EN_DOCS as EN, pageFile, slugsOn, TRANSLATION_DIRS } from "./docs-fs.mjs";

const FLOOR = 40;
const CEIL = 200;

/** 하한·상한 예외. 이유는 IA 문서가 싣는다. */
const SIZE_EXCEPTIONS = new Set([
  "editing/source-mode-and-find", // 유일한 병합 대상이 성격이 무관하다
  "versioning/git", // Git 과 파일 스냅샷은 서로 다른 버전 관리 시스템이다
  "customization/keyboard-shortcuts", // 단축키 레퍼런스는 한 화면에서 훑는 것이 본질이다
]);

const problems = [];

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
  const raw = readFileSync(pageFile(EN, slug), "utf8");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!fm) { problems.push(`[프론트매터 없음] ${slug}`); continue; }
  if (!/^title:/m.test(fm[1])) problems.push(`[title 없음] ${slug}`);
  // ‼️ **줄 전체**를 고정한다. 예전의 `fm[1].includes(JSON.stringify(...))` 는 프론트매터
  //    블록 어디에 그 문자열이 있으면 통과하는 substring 검사였고, `title:` 줄의 모양은
  //    전혀 제약하지 않았다. 그런데 `source-hash.ts` 의 `frontmatterTitle` 은 YAML 파서를
  //    쓰지 않는 근거로 **바로 이 게이트**를 든다. 접힌 스칼라(`>-`)·앵커(`&t`)·여러 줄
  //    값이면 regex 와 실제 YAML 이 서로 다른 제목을 내고, 그러면 디스크 해시와 빌드 해시가
  //    갈려 그 페이지가 번역되는 날 "판정 불일치"로만 드러난다.
  if (TITLES[slug]) {
    const want = `title: ${JSON.stringify(TITLES[slug])}`;
    if (!fm[1].split("\n").includes(want)) {
      problems.push(`[제목 줄 불일치] ${slug} — \`${want}\` 인 줄이 없다 (TITLES 와 정확히 같아야 한다)`);
    }
  }
  const body = raw.slice(fm[0].length).split("\n").length;
  if (body < FLOOR && !SIZE_EXCEPTIONS.has(slug)) problems.push(`[하한] ${slug}: ${body}줄 < ${FLOOR}`);
  if (body > CEIL && !SIZE_EXCEPTIONS.has(slug)) problems.push(`[상한] ${slug}: ${body}줄 > ${CEIL}`);
}

// ── 3. 죽은 예외: 규칙을 만족하는데 예외로 남아 있으면 다음 사람이 오해한다
for (const slug of SIZE_EXCEPTIONS) {
  if (!declared.has(slug)) { problems.push(`[고아 예외] ${slug} — 그런 페이지가 없다`); continue; }
  const file = pageFile(EN, slug);
  if (!file) continue;
  const raw = readFileSync(file, "utf8");
  const body = raw.slice(/^---\n[\s\S]*?\n---\n/.exec(raw)?.[0].length ?? 0).split("\n").length;
  if (body >= FLOOR && body <= CEIL) problems.push(`[불필요한 예외] ${slug}: ${body}줄 — 예외에서 지울 것`);
}

// ── 4. 로케일 대칭: 번역은 없어도 되지만(폴백), 번역에만 있으면 고아다
const translations = TRANSLATION_DIRS.map(({ dir, locale }) => ({
  dir,
  locale,
  slugs: slugsOn(dir),
}));
for (const { locale, slugs } of translations) {
  for (const slug of slugs) {
    if (!onDisk.includes(slug)) {
      problems.push(`[고아 번역] ${locale}/${slug} — 대응하는 en 페이지가 없다`);
    }
  }
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

// ── 6. 번역 스탬프 (§4.2)
//
// 스탬프가 없는 번역은 **낡음을 판정할 수 없다**. 판정할 수 없는 번역은 배너 없이
// 조용히 신뢰받으므로, 사용자에게 보이는 상태 공간을 {번역됨·낡음·미번역} 셋으로
// 닫는다 — 넷째 상태(모름)는 저자의 실수이지 사용자에게 보일 상태가 아니다.
// 낡음 자체는 결함이 아니라 **알려진 상태**다: 배너가 알리고 여기서는 세기만 한다.
const STAMP_RE = new RegExp(`^[0-9a-f]{${SOURCE_HASH_LENGTH}}$`);
let stale = 0;
for (const { dir, locale, slugs } of translations) {
  for (const slug of slugs) {
    if (!onDisk.includes(slug)) continue; // 고아는 4번이 이미 신고했다
    const parts = splitFrontmatter(readFileSync(pageFile(dir, slug), "utf8"));
    if (!parts) { problems.push(`[프론트매터 없음] ${locale}/${slug}`); continue; }
    const stamped = frontmatterSourceHash(parts.frontmatter);
    const expected = hashSourceFile(readFileSync(pageFile(EN, slug), "utf8"), `en/${slug}`);
    const state = translationState(expected, stamped);
    if (state === "unstamped") {
      problems.push(`[미스탬프] ${locale}/${slug} — sourceHash 가 없다. \`npm run i18n:stamp\``);
    } else if (!STAMP_RE.test(stamped)) {
      // 오타 난 스탬프는 어떤 원문과도 일치하지 않아 낡음으로 **영구히** 뜨고,
      // 아래 집계는 그것을 "결함 아님"으로 센다. 여기서 파일 이름을 댄다.
      problems.push(`[스탬프 모양] ${locale}/${slug} — "${stamped}" 는 16진수 ${SOURCE_HASH_LENGTH}자리가 아니다`);
    } else if (state === "stale") stale += 1;
  }
}
for (const slug of onDisk) {
  const parts = splitFrontmatter(readFileSync(pageFile(EN, slug), "utf8"));
  if (parts && frontmatterSourceHash(parts.frontmatter)) {
    problems.push(`[원문에 스탬프] en/${slug} — sourceHash 는 번역본에만 찍는다`);
  }
}
// ── 7. 손으로 세운 도해에는 `not-content` 가 붙어 있어야 한다
//
// ‼️ `markdown.css` 의 flow 규칙이 형제 요소마다 위쪽 여백을 넣는데 제외 목록에 `div` 도
//    `i` 도 없다. 그래서 마크다운 안에 CSS 격자를 세우면 셀이 밀려 내려가고 창 머리 점이
//    계단이 된다 — 실제로 그렇게 배포될 뻔했고, 게이트는 전부 초록이었다(찾은 것은 렌더한
//    스크린샷 하나다). `not-content` 가 Starlight 의 정식 제외이므로 그것을 여기서 요구한다.
//    주석만으로는 다음 도해가 같은 실수를 반복한다.
// ‼️ 클래스는 **토큰으로** 비교한다. `\bui-map\b` 는 하이픈이 낱말 경계라서
//    `ui-map-cell`·`ui-map-status` 까지 잡아 셀마다 오검출이 났다(실측 8건).
const CLASS_ATTR = /class="([^"]*)"/g;
const hasClass = (classes, name) => classes.trim().split(/\s+/).includes(name);
let uiMaps = 0;
for (const { dir, locale } of [{ dir: EN, locale: "en" }, ...translations]) {
  for (const slug of slugsOn(dir)) {
    for (const [, classes] of readFileSync(pageFile(dir, slug), "utf8").matchAll(CLASS_ATTR)) {
      if (!hasClass(classes, "ui-map")) continue;
      uiMaps += 1;
      if (!hasClass(classes, "not-content")) {
        problems.push(
          `[도해에 not-content 없음] ${locale}/${slug} — class="${classes}" 에 not-content 가 없다`,
        );
      }
    }
  }
}
// ‼️ 하나도 못 찾으면 위 단정이 공허하다. 도해를 정말로 없앴다면 이 절도 함께 지우는 것이
//    맞고, 클래스 이름만 바꿨다면 여기가 알려 준다.
if (!uiMaps) {
  problems.push("[도해 0건] `ui-map` 도해를 못 찾았다 — 7번 단정이 공허하다 (클래스 이름이 바뀌었나)");
}

const koCount = translations.reduce((n, t) => n + t.slugs.length, 0);

const localeSummary = translations.map((t) => `${t.locale} ${t.slugs.length}`).join(" · ");
console.log(`선언 ${declared.size} · en ${onDisk.length} · ${localeSummary} · 크기 예외 ${SIZE_EXCEPTIONS.size}`);
console.log(`번역 진행: ${koCount}/${onDisk.length * translations.length} 페이지 · 낡음 ${stale}개 (결함 아님 — 배너가 알린다)`);
console.log();
if (!problems.length) console.log("✅ 문제 없음");
else { console.log(`❌ ${problems.length}건`); for (const p of problems) console.log("  " + p); }
process.exitCode = problems.length ? 1 : 0;
