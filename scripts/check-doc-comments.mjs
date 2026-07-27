// §260 Phase 4b code review (M1) — refuse two `/**` blocks in a row.
//
// WHY a check rather than a convention: `perfectionist/sort-modules` reorders declarations
// on every lint run and moves each one's LEADING comment with it, so anything inserted
// between a doc block and the declaration it describes silently reassigns that doc to a
// different symbol. It reads as documentation and is simply wrong — during §260 Phase 4
// alone it happened four times, twice in the very commits that fixed the previous one,
// including two pre-existing cases nobody had noticed (`settings-resolve.ts`,
// `graph-utils.ts`). The ‼️ adjacency warnings written into the affected files did not
// prevent the next occurrence.
//
// The rule is syntactic: a `*/` whose next non-blank line opens another `/**` means the
// first block documents nothing. Two notes about ONE declaration belong in one block; a
// note about the code rather than the API is a `//` comment.
//
// ‼️ Blank lines between the two blocks are SKIPPED (§260 Phase 4b re-review, M3). The
// first version required adjacency, so one blank line slipped the whole class through —
// the check would have passed by accident, which is worse than no check. The one
// exemption is a MODULE HEADER: a block at the very top of a file documents the module,
// so the first declaration's own doc legitimately follows it. Several files already write
// their header that way; without the exemption a correct file is one deleted blank line
// from a false positive.
import { globSync, readFileSync } from "node:fs";

const ORPHAN = /\*\/[ \t]*\n(?:[ \t]*\n)*[ \t]*\/\*\*/g;

// Wider than `src/` (M3): `scripts/` and `tests/` were unchecked, and this file could not
// check itself.
const files = globSync("{src,scripts,tests}/**/*.{ts,tsx,mjs,js}");
const findings = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(ORPHAN)) {
    // Where the FIRST of the two blocks opens. If only whitespace precedes it, it is the
    // file's module header and documents the module, not the declaration below.
    const openedAt = source.lastIndexOf("/*", match.index);
    if (source.slice(0, openedAt).trim() === "") continue;
    const line = source.slice(0, match.index).split("\n").length;
    findings.push(`${file}:${line}`);
  }
}

if (findings.length > 0) {
  console.error(
    `Found ${findings.length} doc comment(s) followed directly by another doc comment.\n` +
      "The first one documents nothing — merge the two, or make the note a // comment:\n",
  );
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log(`Doc comments OK: ${files.length} files, no orphaned blocks.`);
