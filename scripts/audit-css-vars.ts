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
