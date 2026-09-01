/**
 * Audits CSS custom property usage across the project.
 * Scans both CSS files and TSX/TS inline styles for var() references.
 * Ensures all references resolve to defined variables.
 * Run: npx tsx scripts/audit-css-vars.ts
 */
import fs from "fs";
import path from "path";

/**
 * CSS 주석을 제거한다 — 정의·사용 수집 양쪽에 적용한다.
 *
 * 이슈 515: 생성 CSS의 설명 주석은 과거 이름을 "(was --color-bg-secondary: #f8f9fa)"
 * 형태로 남기는데, raw 정규식이 그 텍스트까지 정의로 수집해 **어디에도 선언되지 않은
 * 변수를 "정의됨"으로 분류**했다. 그 뒤에서 죽은 사용 10건이 이 감사를 통과했고,
 * 감사가 침묵하는 동안 새 위반이 계속 유입됐다. 토큰 이름이 바뀔 때마다 재발하는
 * 구조이므로, 매칭 전에 주석을 벗기는 것이 근본 수정이다. (사용 수집도 같이 벗긴다 —
 * 주석 속 var()가 사용으로 집계되면 이후 역방향 감사가 죽은 정의를 놓치게 된다.)
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * TS/TSX 주석을 벗긴다 — 블록 주석 전체와, 줄 머리가 주석인 줄만. 코드 뒤에 붙는
 * `// …` 트레일링 주석은 건드리지 않는다: 문자열 속 URL(`https://…`)을 주석으로
 * 오인하는 위양성이 실제 코드 손실보다 나쁘고, 지금까지의 오탐(svg-utils의 주석 속
 * `var(--x)` 예시)은 전부 줄 머리 주석이었다.
 */
function stripTsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

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
  const relPath = path.relative(".", file);

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
// 변수 이름("--x" — setProperty/getPropertyValue/색 테이블)을 전부 소비로 세어,
// graph-colors 같은 합법 간접 소비를 죽은 정의로 오탐하지 않는다. 이 집합은
// advisory에만 쓴다 — 미정의 검출의 사용 집계에 넣으면 정의 참조 문자열까지
// "사용"이 되어 검출이 무뎌진다.
const literalMentions = new Set<string>();
for (const file of tsxFiles) {
  const content = stripTsComments(fs.readFileSync(file, "utf-8"));
  const relPath = path.relative(".", file);

  for (const match of content.matchAll(/var\(\s*--([\w-]+)/g)) {
    const varName = `--${match[1]}`;
    if (!usedVars.has(varName)) usedVars.set(varName, []);
    usedVars.get(varName)!.push(relPath);
  }
  for (const match of content.matchAll(/"(--[\w-]+)"/g)) {
    literalMentions.add(match[1]);
  }
}

// 3. Check for undefined references
// Allowlist: Journal runtime variables injected by JS (not in CSS token source)
const ALLOWLIST = new Set([
  "--mood-deep",
  "--mood-calm",
  "--mood-neutral",
  "--mood-warm",
  "--mood-bright",
  "--mood-accent-rgb",
  "--journal-font-family",
  "--journal-line-height",
  "--journal-header-bg",
  "--journal-prompt-bg",
  "--journal-prompt-border",
  // Viewport virtualization + editor zoom (injected at runtime via style.setProperty)
  "--vtop",
  "--vbot",
  "--editor-zoom",
  // §5.1 editor line height — set on .tiptap from the user's setting alongside the inline
  // `line-height` (use-settings-effects.ts), because the list markers, the task checkbox
  // and the fold arrow are absolutely positioned and have to compute WITH it, which an
  // inherited `line-height` cannot do from inside a calc(). Every consumer passes a 1.75
  // fallback, so the stylesheet is still correct before the effect runs.
  "--editor-line-height",
  // §5.1 HTML preview zoom — set as an inline style prop on the frame (HtmlPreview.tsx)
  "--preview-zoom",
  // §272/§274 pdf.js TextLayer (v5+) font-metric input — set as an inline
  // style prop on .pdf-page (PdfPage.tsx), consumed by pdf.css's
  // --text-scale-factor calc().
  "--total-scale-factor",
  // §282 pdf 사이드 레일 폭 — 단일 출처는 PDF_RAIL_WIDTH_PX(TS)다.
  // PdfPreview가 .pdf-preview에 인라인 style prop으로 내려주고, 레일의 width와
  // .pdf-preview-with-rail의 padding-left가 그것을 읽는다. 토큰으로 정의하면
  // 폭이 두 곳(TS의 fit-width 계산 + CSS)에 생겨 어긋날 수 있다.
  "--pdf-rail-width",
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

// 4. Reverse advisory — 정의됐지만 아무도 소비하지 않는 색 토큰.
// 소비로 인정하는 것: CSS/TS의 var() 사용, 그리고 TS가 문자열 리터럴로 든 변수
// 이름(setProperty·getPropertyValue·색 테이블 — graph-colors의 간접 소비가 이렇게
// 잡힌다). 게이트가 아니라 advisory다: 죽은 정의는 즉시 버그가 아니고, 합법
// 소비 경로가 하나 늘 때마다 여기가 빨간불이 되면 아무도 안 읽게 된다. 이 목록이
// 자라면 토큰을 지우거나 소비를 붙이라는 신호다. (이 감사를 넣은 시점의 기준선:
// editor-line-highlight — 사용자가 편집까지 하는데 효과가 없다, git-staged,
// status-warning-solid-hover 3개.)
const unusedColorTokens: string[] = [];
for (const name of semanticDefined) {
  if (!name.startsWith("--color-")) continue;
  if (usedVars.has(name)) continue;
  if (literalMentions.has(name)) continue;
  unusedColorTokens.push(name);
}
if (unusedColorTokens.length > 0) {
  console.log(
    `\n  ADVISORY — defined but unconsumed color tokens (${unusedColorTokens.length}):`,
  );
  for (const name of unusedColorTokens.sort()) console.log(`    ${name}`);
}
