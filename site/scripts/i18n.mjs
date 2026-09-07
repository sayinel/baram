#!/usr/bin/env node
// §4.2 번역 진행판과 스탬프 도구.
//
//   npm run i18n:status                   번역 상태를 보고한다 (보고만 — 종료 코드 0)
//   npm run i18n:stamp                    **아직 안 찍힌** 번역에만 찍는다
//   npm run i18n:stamp -- ko/faq/general   그 페이지에 찍는다 (낡음도 덮어쓴다)
//   npm run i18n:stamp -- --all            낡음까지 전부 덮어쓴다
//
// ‼️ **인자 없는 스탬프는 낡음을 건드리지 않는다.** 스탬프는 낡음 판정이 사는 유일한
//    곳이므로, 덮어쓰는 것은 "이 번역을 원문에 맞게 고쳤다"는 선언이다. 빌드·게이트가
//    권하는 명령이 그 선언을 대신 해 버리면, 번역을 한 글자도 안 고친 채로 낡음 배너가
//    사라지고 되돌릴 방법은 git 뿐이다. 그래서 덮어쓰기는 **이름을 대야** 한다.
//
// ‼️ 판정은 보고하고 막지 않는다. 막는 것은 `check-pages.mjs` 하나다 —
//    같은 판정을 두 곳에서 종료 코드로 내면 둘이 갈릴 때 어느 쪽이 진실인지 알 수 없다.
//
// ‼️ 해시 계산은 `../src/lib/source-hash.ts` 하나뿐이다. 빌드도 같은 함수를 쓴다.
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

import {
  frontmatterSourceHash,
  hashSourceFile,
  splitFrontmatter,
  stampFrontmatter,
  translationState,
} from "../src/lib/source-hash.ts";
import { EN_DOCS, pageFile, slugsOn, TRANSLATION_DIRS } from "./docs-fs.mjs";

const LABELS = {
  current: "최신",
  missing: "미번역",
  orphan: "고아",
  stale: "낡음",
  unstamped: "미스탬프",
};

/** 사용자가 대는 이름. 로케일이 여럿이므로 `<locale>/<slug>` 다. */
const ref = (row) => `${row.locale}/${row.slug}`;

/** 로케일 × 페이지별 상태. en 에 있는 slug 전부 + 번역에만 있는 고아. */
function survey() {
  const en = slugsOn(EN_DOCS);
  const rows = [];
  for (const { dir, locale } of TRANSLATION_DIRS) {
    const translated = new Set(slugsOn(dir));
    for (const slug of en) {
      const expected = hashSourceFile(
        readFileSync(pageFile(EN_DOCS, slug), "utf8"),
        `${slug}`,
      );
      if (!translated.has(slug)) {
        rows.push({ dir, expected, locale, slug, state: "missing" });
        continue;
      }
      const parts = splitFrontmatter(readFileSync(pageFile(dir, slug), "utf8"));
      const stamped = parts
        ? frontmatterSourceHash(parts.frontmatter)
        : undefined;
      rows.push({
        dir,
        expected,
        locale,
        slug,
        stamped,
        state: parts ? translationState(expected, stamped) : "unstamped",
      });
    }
    for (const slug of translated) {
      if (!en.includes(slug)) {
        rows.push({ dir, locale, slug, state: "orphan" });
      }
    }
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
      console.log(`  [${LABELS[row.state]}] ${ref(row)}${detail}`);
    }
    console.log();
    console.log("미스탬프: `npm run i18n:stamp`");
    console.log(
      "낡음: 번역을 원문에 맞게 고친 **뒤** `npm run i18n:stamp -- <경로>`" +
        " — 스탬프를 덮어쓰는 것이 곧 '고쳤다'는 선언이다",
    );
    console.log("고아: 원문이 사라진 것이다 — 빌드가 실패한다");
  }
}

function stamp(argv) {
  const all = argv.includes("--all");
  const named = argv.filter((a) => !a.startsWith("--"));
  const rows = survey().filter((r) => r.state !== "missing");

  const orphans = rows.filter((r) => r.state === "orphan");
  for (const row of orphans) {
    console.error(`❌ 고아 번역: ${ref(row)} — 대응하는 원문이 없습니다`);
  }
  if (orphans.length) process.exit(1);

  const unknown = named.filter((a) => !rows.some((r) => ref(r) === a));
  for (const a of unknown) console.error(`❌ 번역이 없는 경로: ${a}`);
  if (unknown.length) {
    console.error(`   있는 것: ${rows.map(ref).join(" ") || "(없음)"}`);
    process.exit(1);
  }

  // 이름을 댄 것 / --all 은 상태를 묻지 않고 덮어쓴다. 그 외에는 미스탬프만.
  const chosen = named.length
    ? rows.filter((r) => named.includes(ref(r)))
    : rows.filter((r) => all || r.state === "unstamped");
  const skipped = named.length || all
    ? []
    : rows.filter((r) => r.state === "stale");

  // ‼️ 계산을 먼저 전부 끝낸 뒤에 쓴다. 쓰기 루프 안에서 던지면 앞쪽 파일만 찍힌
  //    **부분 스탬프**가 남고, 어디까지 갔는지 알려 주는 것도 없다.
  const writes = [];
  for (const row of chosen) {
    const file = pageFile(row.dir, row.slug);
    const raw = readFileSync(file, "utf8");
    try {
      writes.push({ file, next: stampFrontmatter(raw, row.expected, ref(row)), raw, row });
    } catch (error) {
      // 스택 트레이스를 던지면 무엇을 고쳐야 하는지 안 보인다.
      console.error(`❌ ${relative(process.cwd(), file)}: ${error.message}`);
      console.error("   스탬프는 프론트매터에 찍는다 — 그 파일에 프론트매터를 먼저 넣으십시오.");
      process.exit(1);
    }
  }

  let changed = 0;
  for (const { file, next, raw, row } of writes) {
    if (next === raw) continue;
    writeFileSync(file, next);
    changed += 1;
    const how = row.state === "stale" ? "낡음 위에 덮어씀" : "새로 찍음";
    console.log(`✅ ${relative(process.cwd(), file)} ← ${row.expected} (${how})`);
  }

  console.log(
    changed
      ? `\n${changed}개 파일에 스탬프를 찍었습니다.`
      : `\n바뀐 것이 없습니다 (대상 ${chosen.length}개가 모두 최신).`,
  );
  if (skipped.length) {
    console.log(
      `\n⚠️ 낡음 ${skipped.length}개는 건너뛰었습니다 — 스탬프를 덮어쓰면 낡음 판정이` +
        ` 사라지므로 이름을 대야 합니다:`,
    );
    for (const row of skipped) console.log(`  npm run i18n:stamp -- ${ref(row)}`);
    console.log(`  (전부 고쳤다면: npm run i18n:stamp -- --all)`);
  }
}

const [command, ...rest] = process.argv.slice(2);
if (command === "status") status();
else if (command === "stamp") stamp(rest);
else {
  console.error(
    "사용법: node scripts/i18n.mjs status | stamp [<locale>/<slug>…] [--all]",
  );
  process.exit(1);
}
