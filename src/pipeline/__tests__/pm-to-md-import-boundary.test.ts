// §384 commit 3 — pm→markdown import boundary (design v4.5 §D, r3/r4/r5/r6
// gaps closed). The algorithm (module resolution, AST reference extraction,
// closure/allowlist/barrel construction) lives in
// `./helpers/import-boundary.ts` so the real scan below and every CONTROL
// fixture drive the exact same functions — a CONTROL that used a different
// code path than production would prove nothing.
//
// Three things this file pins:
//  A. The banned module set is built MECHANICALLY (import-edge BFS from
//     pm-to-md.ts, restricted to `src/pipeline/`) — not hand-typed. Sanity
//     guards below would catch a resolver that silently returns nothing.
//  B. The real repo scans clean against a (module, export) allowlist seeded
//     by an actual grep audit (documented in the helper), not a guess.
//  C. CONTROL — six red forms and two green forms, built from LITERAL fixture
//     files under a scratch dir (auto-excluded from every real scan because
//     it lives inside `__tests__`), so nothing here ever mutates a tracked
//     production file. Each CONTROL is the reintroduce → confirm red/green →
//     the fixture is deleted in `afterAll` → evidence step this gate's PR
//     description points back to.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildAllowlist,
  buildForwardedBans,
  buildPipelineClosure,
  buildPipelineInternalSet,
  findViolations,
  loadRealEntries,
  MD_TO_PM_ROUTE_FILES,
  PIPELINE_BARREL_FILE,
  PIPELINE_DIR,
  PM_TO_MD,
  productionSourceFiles,
  resolveModuleId,
  SERIALIZE_LIVE_DOC,
  SRC_DIR,
} from "./helpers/import-boundary";

const ZETTEL_LINK_RESOLVE = join(
  SRC_DIR,
  "utils",
  "export",
  "zettel-link-resolve.ts",
);
const BLOCK_REFERENCE = join(
  SRC_DIR,
  "extensions",
  "nodes",
  "block-reference.ts",
);
const PIPELINE_BARREL = join(PIPELINE_DIR, "index.ts");
const MD_TO_PM = join(PIPELINE_DIR, "md-to-pm.ts");
const PARSE_MDAST = join(PIPELINE_DIR, "parse-mdast.ts");
const PARSE_ASYNC = join(PIPELINE_DIR, "parse-async.ts");
const PARSE_WORKER = join(PIPELINE_DIR, "parse-worker.ts");
const CONVERT_LIST = join(PIPELINE_DIR, "convert-list.ts");
const CONVERT_INLINE_TEXT = join(PIPELINE_DIR, "convert-inline-text.ts");
const CONVERT_BLOCK_SPECIAL = join(PIPELINE_DIR, "convert-block-special.ts");
const BLOCK_ID = join(PIPELINE_DIR, "block-id.ts");
const WIKILINK_TRANSFORMER = join(
  PIPELINE_DIR,
  "transformers",
  "wikilink-transformer.ts",
);
const TRANSFORMERS_INDEX = join(PIPELINE_DIR, "transformers", "index.ts");

describe("pm→markdown closure construction (§384 commit 3-B, r5)", () => {
  const closure = buildPipelineClosure();

  it("reaches a real chunk of the pipeline (guards a broken/empty resolver)", () => {
    expect(closure.size).toBeGreaterThanOrEqual(40);
  });

  it("stays on the pm→markdown side — the md→pm modules are unreachable", () => {
    for (const excluded of [
      MD_TO_PM,
      PARSE_MDAST,
      PARSE_ASYNC,
      PARSE_WORKER,
      CONVERT_LIST,
      CONVERT_INLINE_TEXT,
      CONVERT_BLOCK_SPECIAL,
    ]) {
      expect(closure.has(excluded)).toBe(false);
    }
  });

  it("includes the machinery the exception audits are actually about", () => {
    expect(closure.has(PM_TO_MD)).toBe(true);
    expect(closure.has(BLOCK_ID)).toBe(true);
    expect(closure.has(WIKILINK_TRANSFORMER)).toBe(true);
    expect(closure.has(TRANSFORMERS_INDEX)).toBe(true);
  });
});

describe("resolveModuleId — relative and `@/` alias specifiers land on one id", () => {
  it("a relative specifier from a real file resolves to pm-to-md.ts", () => {
    expect(resolveModuleId(SERIALIZE_LIVE_DOC, "../../pipeline/pm-to-md")).toBe(
      PM_TO_MD,
    );
  });

  it("the `@/` alias resolves the SAME target regardless of the importing file's location", () => {
    // No production file actually uses `@/pipeline/...` today (confirmed by
    // grep at implementation time) — this is the one place that branch of
    // resolveModuleId is exercised at all. Two different `fromFile` locations
    // on purpose: the alias must not depend on where the importer sits.
    expect(resolveModuleId(SERIALIZE_LIVE_DOC, "@/pipeline/pm-to-md")).toBe(
      PM_TO_MD,
    );
    expect(resolveModuleId(BLOCK_REFERENCE, "@/pipeline/pm-to-md")).toBe(
      PM_TO_MD,
    );
  });

  it("an unresolvable specifier (bare package, missing file) is null", () => {
    expect(resolveModuleId(SERIALIZE_LIVE_DOC, "typescript")).toBeNull();
    expect(
      resolveModuleId(SERIALIZE_LIVE_DOC, "../../pipeline/does-not-exist"),
    ).toBeNull();
  });
});

describe("pm→markdown import boundary — real production scan (§384 commit 3-B)", () => {
  const closure = buildPipelineClosure();
  const allowlist = buildAllowlist();
  const allFiles = productionSourceFiles(SRC_DIR);
  const allEntries = loadRealEntries(allFiles);
  const forwarded = buildForwardedBans(closure, allowlist, allEntries);
  // §384 impl-review-1 (F3): SET membership, not `!isInside(PIPELINE_DIR,
  // file)` — the old directory-prefix exemption covered every file under
  // `src/pipeline/`, not merely the 45-module closure, so a pipeline SIBLING
  // (e.g. md-to-pm.ts, outside the closure by design — see the "md→pm
  // modules are unreachable" assertion above) reaching into the closure was
  // invisible to this scan. `buildPipelineInternalSet()` is the closure plus
  // a named, audited list of the actual non-closure pipeline files — see
  // the guard test below for what keeps that list honest.
  const internal = buildPipelineInternalSet();
  const checked = allEntries.filter(
    ({ file }) => !internal.has(file) && file !== SERIALIZE_LIVE_DOC,
  );

  it("scans a real tree (guards against an empty-glob false pass)", () => {
    expect(allFiles.length).toBeGreaterThan(300);
  });

  it("the pipeline-internal exemption is a named set that accounts for every real pipeline file — not a directory prefix that would also cover a brand-new file (§384 F3)", () => {
    const allPipelineFiles = productionSourceFiles(PIPELINE_DIR);
    // Every file under src/pipeline/ today is EITHER in the closure OR one
    // of the named MD→PM route files OR the barrel — nothing is silently
    // unaccounted for by this test itself (that would just mean the
    // production scan below checks it, which is fine) but a mismatch here
    // means the named list drifted from the real tree and needs a look.
    for (const file of allPipelineFiles) {
      expect(internal.has(file)).toBe(true);
    }
    // ...and nothing in the set points at a file that doesn't exist anymore.
    expect(internal.size).toBe(allPipelineFiles.length);
    // The named list itself, spot-checked against the specific files this
    // boundary's own commit history calls out as "the md→pm route".
    for (const file of MD_TO_PM_ROUTE_FILES) {
      expect(closure.has(file)).toBe(false);
    }
    expect(closure.has(PIPELINE_BARREL_FILE)).toBe(false);
  });

  it("the checked set is non-empty and excludes the sanctioned/pipeline-internal paths — NOT a vacuous pass", () => {
    // The violation assertion below runs on `checked`, not `allFiles` — if the
    // exclusion filter ever over-matched, `checked` could silently go empty
    // and the gate would pass with zero coverage. Pin both directions: real
    // external consumers of the closure ARE in the checked set, and the
    // sanctioned/pipeline-internal paths are NOT.
    const checkedFiles = checked.map(({ file }) => file);
    expect(checkedFiles.length).toBeGreaterThan(300);
    expect(checkedFiles).toContain(ZETTEL_LINK_RESOLVE); // allowlisted wikilink import
    expect(checkedFiles).toContain(BLOCK_REFERENCE); // allowlisted block-id import
    expect(checkedFiles).not.toContain(SERIALIZE_LIVE_DOC);
    expect(checkedFiles).not.toContain(PIPELINE_BARREL);
    expect(checkedFiles).not.toContain(PM_TO_MD);
    expect(checkedFiles).not.toContain(MD_TO_PM); // named md→pm route file, not the whole directory
  });

  it("no production file outside pipeline reaches into the closure except the audited allowlist", () => {
    const violations = findViolations(checked, closure, allowlist, forwarded);
    expect(violations.map((v) => `${v.file}:${v.line} — ${v.message}`)).toEqual(
      [],
    );
  });

  it("serialize-live-doc.ts is the one sanctioned direct consumer of prosemirrorToMarkdown", () => {
    const entry = allEntries.find(({ file }) => file === SERIALIZE_LIVE_DOC);
    expect(entry).toBeDefined();
    const importsProsemirrorToMarkdown = (entry?.refs ?? []).some(
      (ref) =>
        ref.module === PM_TO_MD &&
        ref.pairs.some((p) => p.original === "prosemirrorToMarkdown"),
    );
    expect(importsProsemirrorToMarkdown).toBe(true);
  });
});

describe("pm→markdown import boundary — documented residual (r4)", () => {
  it("non-literal dynamic import specifiers are left untouched, by design", () => {
    // Both files call `import(/* @vite-ignore */ url)` with an IDENTIFIER
    // argument, not a string literal — collectReferences correctly produces
    // no reference for it. A blanket dynamic-import ban would also catch
    // this and break the plugin loader's intentional runtime URL import,
    // which has nothing to do with the pm→markdown route. This assertion is
    // a proxy: it currently passes because NEITHER file has any literal
    // dynamic import at all. If it starts failing, check WHICH import
    // changed before assuming the vite-ignore one did — a new, unrelated
    // literal `import("./x")` added to either file would also trip it.
    const files = [
      join(SRC_DIR, "plugins", "plugin-loader.ts"),
      join(SRC_DIR, "sandbox", "sandbox-entry.ts"),
    ];
    const entries = loadRealEntries(files);
    const dynamicRefs = entries
      .flatMap(({ refs }) => refs)
      .filter((ref) => ref.form === "dynamic-import");
    expect(dynamicRefs).toEqual([]);
  });
});

// ── CONTROL — six red forms, two green forms ───────────────────────────────
//
// Fixtures live under `__control_fixtures__/`, inside this `__tests__` dir —
// invisible to `productionSourceFiles()` (it skips every `__tests__` subtree),
// so the real scan above never sees them and nothing here ever touches a
// tracked file. Every fixture specifier is relative to THIS directory
// (`src/pipeline/__tests__/__control_fixtures__/`): `../../x` reaches
// `src/pipeline/x`.

const FIXTURE_DIR = join(import.meta.dirname, "__control_fixtures__");

function writeFixture(name: string, source: string): string {
  const file = join(FIXTURE_DIR, name);
  writeFileSync(file, source, "utf8");
  return file;
}

describe("CONTROL — red/green demonstrations (§384 commit 3-C)", () => {
  const closure = buildPipelineClosure();
  const allowlist = buildAllowlist();

  beforeAll(() => {
    rmSync(FIXTURE_DIR, { force: true, recursive: true });
    mkdirSync(FIXTURE_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(FIXTURE_DIR, { force: true, recursive: true });
  });

  function violationsFor(fileName: string, source: string) {
    const file = writeFixture(fileName, source);
    const entries = loadRealEntries([file]);
    const forwarded = buildForwardedBans(closure, allowlist, entries);
    return findViolations(entries, closure, allowlist, forwarded);
  }

  it("① RED — named import of a banned pm→md export (relative AND `@/` alias)", () => {
    const violations = violationsFor(
      "red-named-import.ts",
      `import { prosemirrorToMarkdown } from "../../pm-to-md";\nvoid prosemirrorToMarkdown;\n`,
    );
    expect(
      violations.some(
        (v) =>
          v.message.includes('"prosemirrorToMarkdown"') &&
          v.message.includes(PM_TO_MD),
      ),
    ).toBe(true);

    // The SAME named export, reached through the `@/` alias instead of a
    // relative specifier, must be caught too — resolveModuleId is unit-tested
    // separately, but this is the end-to-end proof the gate does not have a
    // relative-only blind spot.
    const aliasViolations = violationsFor(
      "red-named-import-alias.ts",
      `import { prosemirrorToMarkdown } from "@/pipeline/pm-to-md";\nvoid prosemirrorToMarkdown;\n`,
    );
    expect(
      aliasViolations.some(
        (v) =>
          v.message.includes('"prosemirrorToMarkdown"') &&
          v.message.includes(PM_TO_MD),
      ),
    ).toBe(true);
  });

  it("② RED — namespace import of an in-set module", () => {
    const violations = violationsFor(
      "red-namespace-import.ts",
      `import * as pmToMd from "../../pm-to-md";\nvoid pmToMd;\n`,
    );
    expect(
      violations.some(
        (v) =>
          v.message.startsWith("namespace-import") &&
          v.message.includes(PM_TO_MD),
      ),
    ).toBe(true);
  });

  it("③ RED — `export * from` barrel re-exposes the closure to a downstream import", () => {
    // Two-file scenario: a barrel that never itself gets scanned as "the"
    // violator still has to make importing THROUGH it red — this is the
    // re-export-closure mechanism (buildForwardedBans), not a literal-pattern
    // match on the consumer's own import line.
    const barrel = writeFixture(
      "red-barrel.ts",
      `export * from "../../pm-to-md";\n`,
    );
    const consumer = writeFixture(
      "red-barrel-consumer.ts",
      `import { prosemirrorToMarkdown } from "./red-barrel";\nvoid prosemirrorToMarkdown;\n`,
    );
    const entries = loadRealEntries([barrel, consumer]);
    const forwarded = buildForwardedBans(closure, allowlist, entries);
    const violations = findViolations(entries, closure, allowlist, forwarded);
    expect(
      violations.some(
        (v) =>
          v.file === consumer && v.message.includes('"prosemirrorToMarkdown"'),
      ),
    ).toBe(true);
  });

  it("④ RED — literal dynamic import of an in-set module", () => {
    const violations = violationsFor(
      "red-dynamic-import.ts",
      [
        "export async function load() {",
        '  return await import("../../pm-to-md");',
        "}",
        "",
      ].join("\n"),
    );
    expect(
      violations.some(
        (v) =>
          v.message.startsWith("dynamic-import") &&
          v.message.includes(PM_TO_MD),
      ),
    ).toBe(true);
  });

  it("⑤ RED — two-step mdast composition (prosemirrorToMdast + mdastToMarkdown)", () => {
    const violations = violationsFor(
      "red-mdast-compose.ts",
      [
        'import { prosemirrorToMdast } from "../../pm-to-md";',
        'import { mdastToMarkdown } from "../../serializer";',
        "export function bypass(doc: unknown) {",
        "  return mdastToMarkdown(prosemirrorToMdast(doc as never));",
        "}",
        "",
      ].join("\n"),
    );
    expect(
      violations.some(
        (v) =>
          v.message.includes('"prosemirrorToMdast"') &&
          v.message.includes(PM_TO_MD),
      ),
    ).toBe(true);
  });

  it("⑥ RED — direct import of the transformer registry entry point", () => {
    const violations = violationsFor(
      "red-transformer-entry.ts",
      `import { pmNodeTransformers } from "../../transformers";\nvoid pmNodeTransformers;\n`,
    );
    expect(
      violations.some(
        (v) =>
          v.message.includes('"pmNodeTransformers"') &&
          v.message.includes(TRANSFORMERS_INDEX),
      ),
    ).toBe(true);
  });

  it("⑦ GREEN — the allowlisted wikilink helper import", () => {
    const violations = violationsFor(
      "green-wikilink.ts",
      [
        'import { serializeWikilink, WIKILINK_RE } from "../../transformers/wikilink-transformer";',
        "void serializeWikilink;",
        "void WIKILINK_RE;",
        "",
      ].join("\n"),
    );
    expect(violations).toEqual([]);
  });

  it("⑧ GREEN — the allowlisted block-id helper import", () => {
    const violations = violationsFor(
      "green-block-id.ts",
      [
        'import { serializeBlockRef, generateBlockId } from "../../block-id";',
        "void serializeBlockRef;",
        "void generateBlockId;",
        "",
      ].join("\n"),
    );
    expect(violations).toEqual([]);
  });

  it("unnumbered — a barrel forwarding a banned name does NOT ban its unrelated re-exports (the false positive buildForwardedBans exists to avoid)", () => {
    // Mirrors the real pipeline/index.ts shape: one barrel re-exports a
    // BANNED name from an in-set module (prosemirrorToMarkdown, from
    // pm-to-md.ts) and an UNRELATED name from a module outside the closure
    // (markdownToProsemirror, from md-to-pm.ts — never reached by the BFS).
    // Treating the whole barrel as banned the moment ANY re-export is banned
    // would flag the second import too — that would be a real production
    // break, since patch-editor-content.ts and friends import
    // markdownToProsemirror through exactly this kind of mixed barrel.
    const barrel = writeFixture(
      "mixed-barrel.ts",
      [
        'export { prosemirrorToMarkdown } from "../../pm-to-md";',
        'export { markdownToProsemirror } from "../../md-to-pm";',
        "",
      ].join("\n"),
    );
    const consumer = writeFixture(
      "mixed-barrel-consumer.ts",
      [
        'import { markdownToProsemirror } from "./mixed-barrel";',
        'import { prosemirrorToMarkdown } from "./mixed-barrel";',
        "void markdownToProsemirror;",
        "void prosemirrorToMarkdown;",
        "",
      ].join("\n"),
    );
    const entries = loadRealEntries([barrel, consumer]);
    const forwarded = buildForwardedBans(closure, allowlist, entries);
    const violations = findViolations(entries, closure, allowlist, forwarded);

    expect(
      violations.some(
        (v) =>
          v.file === consumer && v.message.includes('"prosemirrorToMarkdown"'),
      ),
    ).toBe(true);
    expect(
      violations.some((v) => v.message.includes('"markdownToProsemirror"')),
    ).toBe(false);
  });
});
