/**
 * Audits CSS custom property usage across the project.
 * Scans both CSS files and TSX/TS inline styles for var() references.
 * Ensures all references resolve to defined variables.
 * Run: npx tsx scripts/audit-css-vars.ts
 */
import fs from "fs";
import path from "path";

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
const usedVars = new Map<string, string[]>();

// 1. Scan CSS files for definitions and usages
const cssFiles = findFiles("src/styles", [".css"]);
for (const file of cssFiles) {
  const content = fs.readFileSync(file, "utf-8");
  const relPath = path.relative(".", file);

  for (const match of content.matchAll(/--([\w-]+)\s*:/g)) {
    definedVars.add(`--${match[1]}`);
  }

  for (const match of content.matchAll(/var\(\s*--([\w-]+)/g)) {
    const varName = `--${match[1]}`;
    if (!usedVars.has(varName)) usedVars.set(varName, []);
    usedVars.get(varName)!.push(relPath);
  }
}

// 2. Scan TSX/TS files for inline var() references (usages only, no definitions)
const tsxFiles = [
  ...findFiles("src/components", [".tsx", ".ts"]),
  ...findFiles("src/extensions", [".tsx", ".ts"]),
  ...findFiles("src/hooks", [".ts"]),
];
for (const file of tsxFiles) {
  const content = fs.readFileSync(file, "utf-8");
  const relPath = path.relative(".", file);

  for (const match of content.matchAll(/var\(\s*--([\w-]+)/g)) {
    const varName = `--${match[1]}`;
    if (!usedVars.has(varName)) usedVars.set(varName, []);
    usedVars.get(varName)!.push(relPath);
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
