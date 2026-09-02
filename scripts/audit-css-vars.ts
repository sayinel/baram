/**
 * Audits CSS custom property usage across the project.
 * Scans both CSS files and TSX/TS inline styles for var() references.
 * Ensures all references resolve to defined variables.
 * Run: npx tsx scripts/audit-css-vars.ts
 */
import fs from "fs";
import path from "path";

// 스캔 코어는 src/utils/audit/css-var-scan.ts — 순수 함수라 __tests__의 회귀
// 핀(이슈 515 수용 기준: 주석 속 --x:는 정의가 아니다)이 픽스처로 잠근다.
import {
  stripCssComments,
  stripTsComments,
} from "../src/utils/audit/css-var-scan";

function findFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") walk(full);
      else if (entry.isFile() && extensions.some((ext) => full.endsWith(ext)))
        results.push(full);
    }
  }
  walk(dir);
  return results;
}

const definedVars = new Set<string>();
// 역방향 advisory 대상 — semantic 계층에서 정의된 이름만. primitive 팔레트의
// 미참조 계단(yellow-50…800 등)은 의도된 여분이라 advisory에 실으면 노이즈가 된다.
const semanticDefined = new Set<string>();
const usedVars = new Map<string, string[]>();

// 1. Scan CSS files for definitions and usages
const cssFiles = findFiles("src/styles", [".css"]);
for (const file of cssFiles) {
  const content = stripCssComments(fs.readFileSync(file, "utf-8"));
  // Windows에서 path.relative는 백슬래시를 내므로 substring 검사가 전부
  // 조용히 죽는다(semanticDefined가 비어 advisory 전체가 꺼진다) — 정규화.
  const relPath = path.relative(".", file).split(path.sep).join("/");

  for (const match of content.matchAll(/--([\w-]+)\s*:/g)) {
    definedVars.add(`--${match[1]}`);
    if (
      relPath.includes("generated/semantic") ||
      relPath.includes("generated/system")
    ) {
      semanticDefined.add(`--${match[1]}`);
    }
  }

  for (const match of content.matchAll(/var\(\s*--([\w-]+)/g)) {
    const varName = `--${match[1]}`;
    if (!usedVars.has(varName)) usedVars.set(varName, []);
    usedVars.get(varName)!.push(relPath);
  }
}

// 2. Scan TSX/TS files for inline var() references (usages only, no definitions).
// 이슈 515 후속: components/extensions/hooks 3곳만 보던 범위를 src 전체로 넓힌다 —
// 종전 범위는 standalone export CSS(utils/export/export-html-styles.ts)의 var()
// 16건을 통째로 놓쳤다. 테스트 픽스처의 가짜 변수는 위양성이므로 제외하고,
// spike는 제품 표면이 아니므로 함께 제외한다.
const tsxFiles = findFiles("src", [".tsx", ".ts"]).filter(
  (f) =>
    !f.includes("__tests__") &&
    !/\.test\./.test(f) &&
    !f.includes(`${path.sep}spike${path.sep}`),
);
// 역방향(정의-미소비) advisory의 소비원. var() 외에 TS가 문자열 리터럴로 다루는
// 변수 이름("--x" — getPropertyValue/색 테이블)을 소비로 세어, graph-colors
// 같은 합법 간접 소비를 죽은 정의로 오탐하지 않는다. 이 집합은 advisory에만
// 쓴다 — 미정의 검출의 사용 집계에 넣으면 정의 참조 문자열까지 "사용"이 되어
// 검출이 무뎌진다.
//
// 단, **writer·메타데이터 파일은 소비원이 아니다**(적대 리뷰): 테마 편집
// 메타데이터(types/theme.ts의 THEME_COLOR_KEYS)는 25키 전부를, 테마 적용기
// (utils/theme-vars.ts의 setProperty·DERIVED_KEYS)는 쓰는 쪽 이름을 언급한다.
// 이들을 소비로 세면 "사용자가 편집까지 하는데 아무 효과 없는" 죽은 editable
// 토큰(editor-line-highlight가 실사례)이 advisory에서 구조적으로 숨는다.
const LITERAL_NON_CONSUMERS = new Set([
  "src/types/theme.ts",
  "src/utils/theme-vars.ts",
]);
// 리터럴 경로 스캔의 함정 방지(CLAUDE.md): 파일이 옮겨지면 제외가 조용히
// 무효가 되어 advisory가 3→1로 붕괴한다(적대 리뷰 실측). 크게 죽는다.
for (const excluded of LITERAL_NON_CONSUMERS) {
  if (!fs.existsSync(excluded)) {
    console.error(
      `LITERAL_NON_CONSUMERS 경로가 존재하지 않는다: ${excluded} — 파일을 옮겼으면 이 목록도 갱신할 것`,
    );
    process.exit(1);
  }
}
const literalMentions = new Set<string>();
for (const file of tsxFiles) {
  const content = stripTsComments(fs.readFileSync(file, "utf-8"));
  const relPath = path.relative(".", file).split(path.sep).join("/");

  for (const match of content.matchAll(/var\(\s*--([\w-]+)/g)) {
    const varName = `--${match[1]}`;
    if (!usedVars.has(varName)) usedVars.set(varName, []);
    usedVars.get(varName)!.push(relPath);
  }
  if (LITERAL_NON_CONSUMERS.has(relPath)) continue;
  for (const match of content.matchAll(/"(--[\w-]+)"/g)) {
    literalMentions.add(match[1]);
  }
}

// 3. Check for undefined references
// Allowlist: runtime variables injected by JS (not in CSS token source).
// 감사 순서 8: mood 6종은 제거됐다 — 무드 UI는 slim-journal(03797e3f)에서 내려갔고
// writer 없는 fallback-전용 잔재만 남아 있었다(CSS 규칙도 함께 삭제).
const ALLOWLIST = new Set([
  // §5.1 editor line height — set on .tiptap from the user's setting alongside the inline
  // `line-height` (use-settings-effects.ts), because the list markers, the task checkbox
  // and the fold arrow are absolutely positioned and have to compute WITH it, which an
  // inherited `line-height` cannot do from inside a calc(). Every consumer passes a 1.75
  // fallback, so the stylesheet is still correct before the effect runs.
  "--editor-line-height",
  "--editor-zoom",
  "--journal-font-family",
  "--journal-header-bg",
  "--journal-line-height",
  "--journal-prompt-bg",
  "--journal-prompt-border",
  // §282 pdf 사이드 레일 폭 — 단일 출처는 PDF_RAIL_WIDTH_PX(TS)다.
  // PdfPreview가 .pdf-preview에 인라인 style prop으로 내려주고, 레일의 width와
  // .pdf-preview-with-rail의 padding-left가 그것을 읽는다. 토큰으로 정의하면
  // 폭이 두 곳(TS의 fit-width 계산 + CSS)에 생겨 어긋날 수 있다.
  "--pdf-rail-width",
  // §5.1 HTML preview zoom — set as an inline style prop on the frame (HtmlPreview.tsx)
  "--preview-zoom",
  // §272/§274 pdf.js TextLayer (v5+) font-metric input — set as an inline
  // style prop on .pdf-page (PdfPage.tsx), consumed by pdf.css's
  // --text-scale-factor calc().
  "--total-scale-factor",
  // Viewport virtualization (--vtop/--vbot) — injected at runtime via
  // style.setProperty, like --editor-zoom above.
  "--vbot",
  "--vtop",
]);

const undefinedVars: [string, string[]][] = [];
const allowlistedVars: [string, string[]][] = [];
for (const [name, files] of usedVars) {
  if (!definedVars.has(name)) {
    if (ALLOWLIST.has(name)) {
      allowlistedVars.push([name, [...new Set(files)]]);
    } else {
      undefinedVars.push([name, [...new Set(files)]]);
    }
  }
}

console.log(
  `  Scanned: ${cssFiles.length} CSS + ${tsxFiles.length} TSX/TS files`,
);
console.log(`  Defined: ${definedVars.size} | Referenced: ${usedVars.size}`);

if (allowlistedVars.length > 0) {
  console.log(
    `  Allowlisted (JS runtime): ${allowlistedVars.length} variables`,
  );
}

if (undefinedVars.length > 0) {
  console.error(`\n  UNDEFINED CSS VARIABLES (${undefinedVars.length}):\n`);
  for (const [name, files] of undefinedVars) {
    console.error(`  ${name}`);
    for (const f of files) console.error(`    in ${f}`);
  }
  process.exit(1);
} else {
  console.log(`  All CSS variables are defined (or allowlisted).`);
}

// 4. Reverse audit — 정의됐지만 아무도 소비하지 않는 색 토큰.
// 소비로 인정하는 것: CSS/TS의 var() 사용, 그리고 TS가 문자열 리터럴로 든 변수
// 이름(getPropertyValue·색 테이블 — graph-colors의 간접 소비가 이렇게 잡힌다.
// writer·메타데이터 파일은 LITERAL_NON_CONSUMERS로 제외).
//
// 출력만 하던 advisory에서 **baseline ratchet**으로 승격(적대 리뷰): 목록이
// 자라도 아무도 모르는 침묵은 이슈 515가 제기한 것과 동형이다. 알려진 잔존
// 2개와 다르면 — 늘든 줄든 — 실패시켜, 늘면 소비를 붙이거나 토큰을 지우고,
// 줄면 baseline을 갱신하게 한다.
// (git-staged: git 상태색 세트의 의도적 예비. warning-solid-hover:
//  danger/success 파생 쌍과의 대칭 유지 — derivedVars가 쓰지만 읽는 곳 없음.)
const EXPECTED_UNCONSUMED = new Set([
  "--color-git-staged",
  "--color-status-warning-solid-hover",
]);
const unusedColorTokens: string[] = [];
for (const name of semanticDefined) {
  if (!name.startsWith("--color-")) continue;
  if (usedVars.has(name)) continue;
  if (literalMentions.has(name)) continue;
  unusedColorTokens.push(name);
}
const unexpectedUnused = unusedColorTokens.filter(
  (n) => !EXPECTED_UNCONSUMED.has(n),
);
const goneFromBaseline = [...EXPECTED_UNCONSUMED].filter(
  (n) => !unusedColorTokens.includes(n),
);
if (unusedColorTokens.length > 0) {
  console.log(
    `\n  Unconsumed color tokens (${unusedColorTokens.length}, baseline ${EXPECTED_UNCONSUMED.size}):`,
  );
  for (const name of unusedColorTokens.sort()) console.log(`    ${name}`);
}
if (unexpectedUnused.length > 0 || goneFromBaseline.length > 0) {
  if (unexpectedUnused.length > 0)
    console.error(
      `\n  NEW unconsumed tokens (consume them or delete them): ${unexpectedUnused.join(", ")}`,
    );
  if (goneFromBaseline.length > 0)
    console.error(
      `\n  Baseline tokens now consumed or gone (update EXPECTED_UNCONSUMED): ${goneFromBaseline.join(", ")}`,
    );
  process.exit(1);
}
