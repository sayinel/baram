#!/usr/bin/env node
// §4.2 번역 진행판과 스탬프 도구.
//
//   npm run i18n:status            번역 상태를 보고한다 (보고만 한다 — 종료 코드 0)
//   npm run i18n:stamp             모든 ko 파일에 현재 en 해시를 찍는다
//   npm run i18n:stamp -- faq/general …   특정 페이지만
//
// ‼️ 판정은 보고하고 **막지 않는다.** 막는 것은 `check-pages.mjs` 하나다.
//    같은 판정을 두 곳에서 종료 코드로 내면 둘이 갈릴 때 어느 쪽이 진실인지 알 수 없다.
//
// ‼️ 해시 계산은 `../src/lib/source-hash.ts` 하나뿐이다. 빌드도 같은 함수를 쓴다 —
//    두 벌이면 스탬프를 찍자마자 낡음으로 뜨는 식으로 갈린다.
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

import {
  frontmatterSourceHash,
  hashSourceFile,
  splitFrontmatter,
  stampFrontmatter,
  translationState,
} from "../src/lib/source-hash.ts";
import { EN_DOCS, KO_DOCS, pageFile, slugsOn } from "./docs-fs.mjs";

const LABELS = {
  current: "최신",
  missing: "미번역",
  orphan: "고아",
  stale: "낡음",
  unstamped: "미스탬프",
};

/** 페이지별 상태. en 에 있는 slug 전부 + ko 에만 있는 고아. */
function survey() {
  const en = slugsOn(EN_DOCS);
  const ko = new Set(slugsOn(KO_DOCS));
  const rows = [];
  for (const slug of en) {
    const enFile = pageFile(EN_DOCS, slug);
    const expected = hashSourceFile(readFileSync(enFile, "utf8"), `en/${slug}`);
    if (!ko.has(slug)) {
      rows.push({ expected, slug, state: "missing" });
      continue;
    }
    const koRaw = readFileSync(pageFile(KO_DOCS, slug), "utf8");
    const parts = splitFrontmatter(koRaw);
    const stamped = parts ? frontmatterSourceHash(parts.frontmatter) : undefined;
    rows.push({
      expected,
      slug,
      stamped,
      state: parts ? translationState(expected, stamped) : "unstamped",
    });
  }
  for (const slug of ko) {
    if (!en.includes(slug)) rows.push({ slug, state: "orphan" });
  }
  return rows;
}

function status() {
  const rows = survey();
  const count = (state) => rows.filter((r) => r.state === state).length;
  const translated = rows.length - count("missing") - count("orphan");
  const total = rows.length - count("orphan");
  const pct = total ? Math.round((translated / total) * 100) : 0;

  console.log(`번역 ${translated}/${total} 페이지 (${pct}%)`);
  console.log(
    ["current", "stale", "unstamped", "missing", "orphan"]
      .map((s) => `${LABELS[s]} ${count(s)}`)
      .join(" · "),
  );

  // 손이 필요한 것만 열거한다. 미번역 55줄은 진행판이 아니라 소음이다.
  const actionable = rows.filter((r) =>
    ["orphan", "stale", "unstamped"].includes(r.state),
  );
  if (actionable.length) {
    console.log();
    for (const row of actionable) {
      const detail =
        row.state === "stale"
          ? ` (원문 ${row.expected} ≠ 스탬프 ${row.stamped})`
          : "";
      console.log(`  [${LABELS[row.state]}] ${row.slug}${detail}`);
    }
    console.log();
    console.log("낡음·미스탬프는 번역을 갱신한 뒤 `npm run i18n:stamp`.");
    console.log("고아는 원문이 사라진 것이다 — 빌드가 실패한다.");
  }
}

function stamp(only) {
  const rows = survey().filter((r) => r.state !== "missing");
  const orphans = rows.filter((r) => r.state === "orphan");
  for (const row of orphans) {
    console.error(`❌ 고아 번역: ko/${row.slug} — 대응하는 en 페이지가 없습니다`);
  }
  if (orphans.length) process.exit(1);

  const targets = only.length
    ? rows.filter((r) => only.includes(r.slug))
    : rows;
  const unknown = only.filter((s) => !rows.some((r) => r.slug === s));
  for (const slug of unknown) {
    console.error(`❌ 번역이 없는 slug: ${slug}`);
  }
  if (unknown.length) process.exit(1);

  let changed = 0;
  for (const row of targets) {
    const file = pageFile(KO_DOCS, row.slug);
    const raw = readFileSync(file, "utf8");
    const next = stampFrontmatter(raw, row.expected, `ko/${row.slug}`);
    if (next === raw) continue;
    writeFileSync(file, next);
    changed += 1;
    console.log(`✅ ${relative(process.cwd(), file)} ← ${row.expected}`);
  }
  console.log(
    changed
      ? `\n${changed}개 파일에 스탬프를 찍었습니다.`
      : `\n바뀐 것이 없습니다 (대상 ${targets.length}개가 모두 최신).`,
  );
}

const [command, ...rest] = process.argv.slice(2);
if (command === "status") status();
else if (command === "stamp") stamp(rest);
else {
  console.error("사용법: node scripts/i18n.mjs status | stamp [slug…]");
  process.exit(1);
}
