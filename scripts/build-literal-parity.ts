// issue 669 — turn a recorded corpus (scripts/literal-parity.sh dump) into the
// committed parity fixture and its inventory.
//
// The oracle is the app's own reader: `referenceIsEditable` from
// `block-id-rename-markdown.ts`, which parses with the shared stack
// (`pipeline/markdown-parser.ts`) and overlaps every literal mdast node
// against the reference. Deriving the answer here instead would make the
// frontend assertion compare a test against itself.
//
//   npx tsx scripts/build-literal-parity.ts <corpus.jsonl>
//
// The recorder writes what `Literal` alone said for each document, so the
// validation against the historical Rust measurement needs no second file.
//
// Writes src-tauri/src/md/fixtures/literal-parity.json and
//        src-tauri/src/md/fixtures/literal-parity-inventory.json
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  LITERAL_TYPES,
  referenceIsEditable,
} from "../src/utils/editor/block-id-rename-markdown";
import { markdownParser } from "../src/pipeline/markdown-parser";

/** The corpus marker, and the grammar production applies to it: one line. */
const MARKER = /\(\(n#\^o(?:\|[^)]+)?\)\)/g;

/** Payloads this big are excluded from the fixture; the inventory keeps the
 *  hash so the absence is recorded rather than silent. */
const MAX_DOCUMENT_BYTES = 8 * 1024;

/** Front matter, by the same rule `md/literal/lines.rs` applies: the first
 *  line (a BOM does not count) is exactly `---` with optional trailing spaces
 *  or tabs, and a later line is too. No closer means no front matter. */
function frontMatterEnd(markdown: string): number {
  const body = markdown.startsWith("﻿") ? markdown.slice(1) : markdown;
  const shift = markdown.length - body.length;
  const isFence = (line: string): boolean => /^---[ \t]*$/.test(line);
  const lines: { end: number; start: number; text: string }[] = [];
  let at = 0;
  for (const m of body.matchAll(/\r\n|\n|\r/g)) {
    lines.push({
      start: at,
      text: body.slice(at, m.index),
      end: m.index + m[0].length,
    });
    at = m.index + m[0].length;
  }
  if (at < body.length)
    lines.push({ start: at, text: body.slice(at), end: body.length });
  if (lines.length === 0 || !isFence(lines[0].text)) return 0;
  for (let i = 1; i < lines.length; i++) {
    if (isFence(lines[i].text)) return lines[i].end + shift;
  }
  return 0;
}

/** Why a marker is not editable, for the diff and the failure message —
 *  never asserted. */
function reason(markdown: string, start: number, end: number): string {
  if (start < frontMatterEnd(markdown)) return "frontmatter";
  const overlapping = new Set<string>();
  const shift = markdown.startsWith("﻿") ? 1 : 0;
  const visit = (node: any): void => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from !== undefined && to !== undefined) {
      if (
        LITERAL_TYPES.has(node.type) &&
        start < to + shift &&
        end > from + shift
      ) {
        overlapping.add(node.type);
        return;
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(markdownParser.parse(markdown));
  return overlapping.size > 0 ? [...overlapping].sort().join("+") : "prose";
}

const [corpusPath] = process.argv.slice(2);
if (!corpusPath) {
  console.error(
    "usage: npx tsx scripts/build-literal-parity.ts <corpus.jsonl>",
  );
  process.exit(2);
}

const records: Record<string, any>[] = readFileSync(corpusPath, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
if (records.length === 0) {
  console.error("build-literal-parity: the corpus is empty");
  process.exit(1);
}

const byKey = new Map<string, boolean[]>(
  records.map((r) => [`${r.test}#${r.ordinal}`, r.literalAlone as boolean[]]),
);
interface Case {
  bytes: number;
  editable: boolean[];
  markdown: string;
  ordinal: number;
  sha256: string;
  test: string;
  why: string[];
}
const cases: Case[] = [];
const inventory: Record<string, unknown>[] = [];
for (const record of records) {
  const { markdown, test, ordinal, sha256, bytes } = record;
  const occurrences = [...markdown.matchAll(MARKER)];
  // The recorder counted with the same grammar; if these part, one of the
  // two regexes moved and the fixture would describe a corpus nobody runs.
  if (occurrences.length !== record.markers) {
    console.error(
      `build-literal-parity: ${test}#${ordinal} — the recorder counted ${record.markers} marker(s), this counts ${occurrences.length}`,
    );
    process.exit(1);
  }
  if (occurrences.length === 0) {
    console.error(`build-literal-parity: ${test}#${ordinal} holds no marker`);
    process.exit(1);
  }
  const entry = { test, ordinal, sha256, bytes };
  if (bytes > MAX_DOCUMENT_BYTES) {
    inventory.push({ ...entry, excluded: "performance/pathological-size" });
    continue;
  }
  inventory.push(entry);
  cases.push({
    test,
    ordinal,
    sha256,
    bytes,
    markdown,
    editable: occurrences.map((m) =>
      referenceIsEditable(markdown, m.index, m.index + m[0].length),
    ),
    why: occurrences.map((m) =>
      reason(markdown, m.index, m.index + m[0].length),
    ),
  });
}

const fixtures = path.join(
  import.meta.dirname,
  "..",
  "src-tauri",
  "src",
  "md",
  "fixtures",
);
const contract = [
  "issue 669. One boolean per `((n#^o))` occurrence: would the link index read it as a",
  "rewritable reference? Rust answers `!Literal::of(md).overlaps(range) && range.start >=",
  "front_matter_end(md)`; the frontend answers with `referenceIsEditable`, which parses with",
  "the shared stack and OVERLAPS every literal mdast node against the range — not containment:",
  "`((n#^o|`x`))` holds an inlineCode child, so no literal node contains the reference and one",
  "overlaps it. `why` is provenance for diffs and failure messages and is never asserted.",
  "`sha256` and `bytes` are of `markdown` as UTF-8: scripts/literal-parity.sh check recomputes",
  "both, so a case whose document drifted from the recorded corpus cannot pass by updating the",
  "inventory alone.",
  "",
  "The marker is one line, target `n`, id `o`, optional display. The conditions `extract_links`",
  "applies that this predicate omits are unreachable for this corpus, measured: 0 embeds, 0",
  "empty displays `((n#^o|))`, 0 markers with a line break in the display, never an empty",
  "target, never an empty id. The marker grammar here is production's `BLOCK_REF_RE`: a display",
  "of at least one character, line breaks included. The `refs` helper is wider by one shape —",
  "an empty display, which production rejects — and the recorder asserts the two counts agree,",
  "so a case production could not see stops the dump instead of being filed here.",
  "",
  "GENERATED — do not edit. Regenerate with:",
  "  scripts/literal-parity.sh dump /tmp/corpus.jsonl",
  "  npx tsx scripts/build-literal-parity.ts /tmp/corpus.jsonl",
].join("\n");

writeFileSync(
  path.join(fixtures, "literal-parity.json"),
  `${JSON.stringify({ contract, literalNodeTypes: [...LITERAL_TYPES].sort(), cases }, null, 2)}\n`,
);
writeFileSync(
  path.join(fixtures, "literal-parity-inventory.json"),
  `${JSON.stringify(
    {
      contract:
        "issue 669. Identity of every document `refs()` exercises. scripts/literal-parity.sh check compares this with a fresh dump, so an added, replaced or removed case fails. A document may carry `excluded` only if its recorded size is above `maxDocumentBytes` — the check re-derives that from the fresh dump, so marking a case excluded is not a way to drop it.",
      maxDocumentBytes: MAX_DOCUMENT_BYTES,
      documents: inventory,
    },
    null,
    2,
  )}\n`,
);

const excluded = inventory.filter((d) => d.excluded).length;
console.error(
  `build-literal-parity: ${cases.length} cases (${inventory.length} documents, ${excluded} excluded), ` +
    `${cases.reduce((n, c) => n + c.editable.length, 0)} marker occurrences`,
);

// Validate against the historical Rust measurement. `literalAlone` is what
// `Literal` alone said; the index expectation derives from it by the same
// front-matter rule, and that is what the oracle must agree with.
let disagreements = 0;
for (const c of cases) {
  const historical = byKey.get(`${c.test}#${c.ordinal}`);
  if (!historical) continue;
  const occurrences = [...c.markdown.matchAll(MARKER)];
  const derived = historical.map(
    (literalAlone, i) =>
      literalAlone && occurrences[i].index >= frontMatterEnd(c.markdown),
  );
  if (JSON.stringify(derived) !== JSON.stringify(c.editable)) {
    console.error(`  DISAGREE ${c.test}#${c.ordinal}`);
    console.error(`    markdown ${JSON.stringify(c.markdown)}`);
    console.error(
      `    rust     ${JSON.stringify(derived)} (literal-alone ${JSON.stringify(historical)})`,
    );
    console.error(
      `    oracle   ${JSON.stringify(c.editable)}  why ${JSON.stringify(c.why)}`,
    );
    disagreements++;
  }
}
console.error(
  `build-literal-parity: ${disagreements} disagreement(s) against the Rust measurement`,
);
if (disagreements > 0) process.exit(1);
