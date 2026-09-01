// §384 commit 3 — pm→markdown import boundary (design v4.5 §D). Test-support
// module: the mechanical graph-closure algorithm lives here, kept apart from
// the `describe`/`it` blocks in `../pm-to-md-import-boundary.test.ts` so both
// the real scan and the CONTROL fixtures can drive the exact same functions.
//
// What this closes: `prosemirrorToMarkdown`/`prosemirrorToMdast` left
// `pipeline/index.ts`'s production re-exports (commit 3-A), but a barrel is
// presentation — nothing stopped a NEW barrel, a namespace import, a literal
// dynamic import, or hand-composing `mdastToMarkdown(prosemirrorToMdast(doc))`
// from reaching the same conversion machinery and bypassing the canonical
// collapse in `src/utils/editor/serialize-live-doc.ts`. This module builds the
// banned surface mechanically (by following import edges, not a hand-typed
// list) and checks every production import against it.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";

// ── paths ────────────────────────────────────────────────────────────────

export const SRC_DIR = resolve(import.meta.dirname, "..", "..", "..");
export const PIPELINE_DIR = join(SRC_DIR, "pipeline");
export const PM_TO_MD = join(PIPELINE_DIR, "pm-to-md.ts");
export const SERIALIZE_LIVE_DOC = join(
  SRC_DIR,
  "utils",
  "editor",
  "serialize-live-doc.ts",
);

/** True when `file` is `dir` itself or lives under it. */
function isInside(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export { isInside };

// ── module resolution — relative and `@/` specifiers land on one module id ─

/** Resolve an import/export specifier used in `fromFile` to an absolute file
 * path, or `null` for a bare package specifier (no "." / "@/" prefix) or one
 * that does not resolve to a real file on disk. */
export function resolveModuleId(
  fromFile: string,
  specifier: string,
): null | string {
  let base: string;
  if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else if (specifier.startsWith("@/")) {
    base = resolve(SRC_DIR, specifier.slice(2));
  } else {
    return null; // node_modules package — not part of this codebase's graph
  }
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// ── file tree scan ──────────────────────────────────────────────────────

/**
 * All production `.ts`/`.tsx`/`.mts`/`.cts` files under `dir` — no
 * `__tests__`, no `.test.`. §384 (F3 caveat): the repository currently has no
 * `.mts`/`.cts` pipeline siblings, but a future one would otherwise be
 * invisible to this scanner and silently escape the import-boundary audit.
 */
export function productionSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...productionSourceFiles(path));
    } else if (
      /\.(ts|tsx|mts|cts)$/.test(entry.name) &&
      !/\.test\./.test(entry.name)
    ) {
      out.push(path);
    }
  }
  return out;
}

// ── reference extraction (TypeScript compiler AST — mechanical, not regex) ─

export interface ModuleRef {
  form: RefForm;
  line: number;
  module: string;
  /** Populated for named/default forms; empty for namespace/star/dynamic forms
   * — those reach the whole module surface, not a specific name. */
  pairs: NamePair[];
}

export type RefForm =
  | "default-import"
  | "dynamic-import" // literal specifier only — see collectReferences
  | "export-named"
  | "export-namespace-star" // `export * as ns from "spec"`
  | "export-star" // `export * from "spec"`
  | "named-import"
  | "namespace-import"; // `import * as ns from "spec"`

/** `original` is the name as the TARGET module exports it (propertyName when
 * aliased); `local` is the name bound/re-exported in THIS file. Only `original`
 * matters for the allowlist check; `local` matters for barrel forwarding
 * (what a downstream file would ask this barrel for). */
export interface NamePair {
  local: string;
  original: string;
}

const WHOLE_MODULE_FORMS: ReadonlySet<RefForm> = new Set([
  "dynamic-import",
  "export-namespace-star",
  "export-star",
  "namespace-import",
]);

export interface FileRefs {
  file: string;
  refs: ModuleRef[];
}

export function isWholeModuleForm(form: RefForm): boolean {
  return WHOLE_MODULE_FORMS.has(form);
}

function bindingName(el: ts.ExportSpecifier | ts.ImportSpecifier): string {
  return (el.propertyName ?? el.name).text;
}

/**
 * Every import/export-from/literal-dynamic-import reference in `sourceText`,
 * resolved to absolute module ids. Pure — no disk I/O — so both the real scan
 * (reads the file first) and the CONTROL fixtures (a literal string) share it.
 *
 * `import type { X } from "spec"` is NOT special-cased — a type-only import
 * is checked exactly like a value import. No current production file imports
 * a TYPE from anywhere in the closure (confirmed at implementation time), so
 * this never fires today; it is a deliberate over-block default, not an
 * oversight, matching this boundary's bias elsewhere (namespace/dynamic are
 * unconditionally red too).
 *
 * Non-literal dynamic imports — `import(/* @vite-ignore *\/ url)` in the
 * plugin loader (`src/plugins/plugin-loader.ts`) and the sandbox entry
 * (`src/sandbox/sandbox-entry.ts`) — are deliberately NOT tracked (r4): a
 * blanket rejection of dynamic import would also break that intentional
 * runtime URL import, which has nothing to do with the pm→markdown route.
 * This is the boundary's one documented residual gap.
 */
export function collectReferences(
  filePath: string,
  sourceText: string,
): ModuleRef[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const refs: ModuleRef[] = [];
  const lineOf = (pos: number) =>
    sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

  function push(
    form: RefForm,
    specifier: string,
    pairs: NamePair[],
    pos: number,
  ) {
    const module = resolveModuleId(filePath, specifier);
    if (module) refs.push({ form, line: lineOf(pos), module, pairs });
  }

  function visit(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier.text;
      const clause = node.importClause;
      const pos = node.getStart();
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        push("namespace-import", spec, [], pos);
      }
      const namedPairs: NamePair[] = [];
      if (clause?.name)
        namedPairs.push({ local: clause.name.text, original: "default" });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          namedPairs.push({ local: el.name.text, original: bindingName(el) });
        }
      }
      if (namedPairs.length > 0) {
        push(
          clause?.name && namedPairs.length === 1
            ? "default-import"
            : "named-import",
          spec,
          namedPairs,
          pos,
        );
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier.text;
      const pos = node.getStart();
      if (!node.exportClause) {
        push("export-star", spec, [], pos);
      } else if (ts.isNamespaceExport(node.exportClause)) {
        push("export-namespace-star", spec, [], pos);
      } else if (ts.isNamedExports(node.exportClause)) {
        const pairs = node.exportClause.elements.map((el) => ({
          local: el.name.text,
          original: bindingName(el),
        }));
        push("export-named", spec, pairs, pos);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      // Literal specifier only (design r4) — a non-literal argument (the
      // plugin loader's `@vite-ignore` URL import) is silently skipped, not
      // an error: it is out of this boundary's scope by design, not a gap.
      if (arg && ts.isStringLiteralLike(arg)) {
        push("dynamic-import", arg.text, [], node.getStart());
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return refs;
}

/** Real-file convenience: read + parse + cache. Used by the actual repo scan;
 * CONTROL fixtures build `FileRefs` directly from a literal string instead. */
export function loadRealEntries(files: string[]): FileRefs[] {
  return files.map((file) => ({
    file,
    refs: collectReferences(file, readFileSync(file, "utf8")),
  }));
}

// ── the banned module set — import edges from pm-to-md.ts, pipeline-internal ─

/**
 * BFS from `pm-to-md.ts` following import AND export-from edges, restricted to
 * targets that resolve inside `src/pipeline/`. This is "the pm→markdown
 * route": pm-to-md.ts itself, the transformer registry and every transformer
 * it reaches, `serializer.ts`, `block-id.ts`, `types.ts`. An edge leaving
 * `src/pipeline/` (e.g. `../utils/media-src`, a plain shared utility pm-to-md
 * happens to depend on) is a leaf, not part of the route — it is not banned,
 * exactly as it is not banned for md-to-pm.ts's equivalent dependencies.
 */
export function buildPipelineClosure(): Set<string> {
  const closure = new Set<string>([PM_TO_MD]);
  const queue = [PM_TO_MD];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    const refs = collectReferences(current, readFileSync(current, "utf8"));
    for (const ref of refs) {
      if (!isInside(PIPELINE_DIR, ref.module)) continue;
      if (!closure.has(ref.module)) {
        closure.add(ref.module);
        queue.push(ref.module);
      }
    }
  }
  return closure;
}

// ── the pipeline-internal exemption — a named set, not a directory prefix ──
//
// §384 impl-review-1 (F3): the real scan below used to exempt every file
// under `src/pipeline/` wholesale (`!isInside(PIPELINE_DIR, file)`), not just
// the 45-module closure. That is a mechanical blind spot: ANY new file later
// dropped into `src/pipeline/` — including one the closure's BFS never
// reaches — silently inherited the exemption too, so a PM→mdast call added
// to it would pass this gate undetected. Set membership does not grow on its
// own the way a path-prefix test does: a new file is either not in this set
// (and gets checked exactly like an external consumer, closing that gap) or
// someone deliberately adds it here, next to this audit trail — the same way
// `buildAllowlist()`'s entries are added.

/**
 * The nine production files that make up the OTHER side of this pipeline —
 * the actual MD→PM ("parse") route (`md-to-pm.ts` and its own helper
 * modules) — audited 2026-09-02 as exactly `productionSourceFiles(PIPELINE_DIR)`
 * minus `buildPipelineClosure()` minus the barrel (tracked separately below,
 * since it carries no conversion logic of its own). They need the SAME
 * dynamic-dispatch registries (`nodeTransformers`/`markTransformers`, keyed
 * by mdastType) the closure's own modules provide — for the harmless MD→PM
 * direction. The risk this boundary defends against is specifically PM→MD
 * (serialize) leaving pipeline unescorted, not the reverse.
 *
 * `convert-inline.ts` and `convert-table-colwidths.ts` were added by the
 * pure-move split of `md-to-pm.ts` (2026-09-02, seven → nine) — a pure
 * relocation of existing MD→PM code, not new production surface.
 */
export const MD_TO_PM_ROUTE_FILES: ReadonlySet<string> = new Set([
  join(PIPELINE_DIR, "convert-block-special.ts"),
  join(PIPELINE_DIR, "convert-inline-text.ts"),
  join(PIPELINE_DIR, "convert-inline.ts"),
  join(PIPELINE_DIR, "convert-list.ts"),
  join(PIPELINE_DIR, "convert-table-colwidths.ts"),
  join(PIPELINE_DIR, "md-to-pm.ts"),
  join(PIPELINE_DIR, "parse-async.ts"),
  join(PIPELINE_DIR, "parse-mdast.ts"),
  join(PIPELINE_DIR, "parse-worker.ts"),
]);

/** The pipeline's public barrel — re-exports only, no conversion logic of its
 *  own. Exempted for the same "pipeline-internal wiring" reason, tracked
 *  separately from `MD_TO_PM_ROUTE_FILES` since it belongs to neither
 *  direction's actual machinery. */
export const PIPELINE_BARREL_FILE = join(PIPELINE_DIR, "index.ts");

/**
 * The full pipeline-internal exemption: the pm→markdown closure plus the
 * named md→pm route files plus the barrel — SET membership, checked by the
 * real scan below instead of a `src/pipeline/` path-prefix test.
 */
export function buildPipelineInternalSet(): Set<string> {
  return new Set<string>([
    ...buildPipelineClosure(),
    ...MD_TO_PM_ROUTE_FILES,
    PIPELINE_BARREL_FILE,
  ]);
}

// ── the allowlist — seeded by an implementation-time audit, not a guess ────

/**
 * Named (module, export) pairs known — by grepping every production import
 * into the closure at implementation time — to be neutral: parsers/serializers
 * of a syntax fragment (a regex match, a set of attrs) that never touch a
 * ProseMirror doc or an mdast tree. Importing anything else from an in-set
 * module stays red. Audited 2026-08-30:
 *
 *   grep -rn 'from ".*pipeline[/"]' --include='*.ts' --include='*.tsx' src \
 *     | grep -v '^src/pipeline/' | grep -v '__tests__\|\.test\.'
 *
 * turned up exactly these two families and no others.
 */
export function buildAllowlist(): Map<string, Set<string>> {
  const blockId = join(PIPELINE_DIR, "block-id.ts");
  const wikilink = join(
    PIPELINE_DIR,
    "transformers",
    "wikilink-transformer.ts",
  );
  return new Map([
    [
      blockId,
      new Set([
        // extensions/nodes/block-reference.ts — InputRule/pasteRule matching
        // and §276.6 width parsing; turns already-typed text into node attrs.
        "BLOCK_REF_RE",
        // components/editor/pdf/use-pdf-highlights.ts — percent-escapes a
        // path string for embedding as a block-ref target.
        "escapeBlockRefTarget",
        // extensions/plugins/block-id-decoration.ts,
        // components/editor/pdf/pdf-highlight-actions.ts — mints a random id,
        // no markdown in or out.
        "generateBlockId",
        "parseBlockRefMatch",
        "parseRefWidth",
        // components/editor/pdf/use-pdf-highlight-write-actions.ts — builds a
        // ((...)) string from attrs the caller already has (not from a live
        // PM doc).
        "serializeBlockRef",
        // utils/editor/wikilink-nav.ts,
        // components/editor/pdf/pdf-highlight-sidecar.ts — inverse of the
        // above, decoding a target back to a real path.
        "unescapeBlockRefTarget",
      ]),
    ],
    [
      wikilink,
      new Set([
        "serializeWikilink",
        // utils/export/zettel-link-resolve.ts — reuses the [[...]] regex and
        // rebuilds the string from attrs it already parsed out, for EXPORT
        // markdown assembly only (never the in-app save path).
        "WIKILINK_RE",
      ]),
    ],
  ]);
}

// ── barrel forwarding — the re-export closure ──────────────────────────────

export type Forward = "*" | Set<string>;

function isNamedBanned(
  module: string,
  name: string,
  closure: ReadonlySet<string>,
  allowlist: ReadonlyMap<string, ReadonlySet<string>>,
  forwarded: ReadonlyMap<string, Forward>,
): boolean {
  if (closure.has(module)) return !(allowlist.get(module)?.has(name) ?? false);
  const fb = forwarded.get(module);
  if (fb === "*") return true;
  return fb ? fb.has(name) : false;
}

function isWholeBanned(
  module: string,
  closure: ReadonlySet<string>,
  forwarded: ReadonlyMap<string, Forward>,
): boolean {
  return closure.has(module) || forwarded.has(module);
}

export { isNamedBanned, isWholeBanned };

/**
 * Fixed-point closure over `entries`' export-from statements: a file that
 * re-exports a banned name (or star-re-exports an in-set/forwarding module)
 * becomes a forwarding barrel itself, under the LOCAL name it re-exports as —
 * not a blanket "this whole file is banned". That distinction is load-bearing:
 * `pipeline/index.ts` re-exports `mdastToMarkdown` (banned — no allowlist
 * entry for it, nothing outside pipeline currently imports it either) from
 * the SAME barrel that re-exports `markdownToProsemirror` (not banned — it
 * points at md-to-pm.ts, outside the closure). Treating the barrel file as
 * wholesale-banned the moment ANY of its re-exports is banned would flag
 * every real `markdownToProsemirror` import through that barrel — a false
 * positive this module must not produce.
 */
export function buildForwardedBans(
  closure: ReadonlySet<string>,
  allowlist: ReadonlyMap<string, ReadonlySet<string>>,
  entries: FileRefs[],
): Map<string, Forward> {
  const forwarded = new Map<string, Forward>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const { file, refs } of entries) {
      for (const ref of refs) {
        if (
          ref.form === "export-star" ||
          ref.form === "export-namespace-star"
        ) {
          if (
            isWholeBanned(ref.module, closure, forwarded) &&
            forwarded.get(file) !== "*"
          ) {
            forwarded.set(file, "*");
            changed = true;
          }
        } else if (ref.form === "export-named") {
          if (forwarded.get(file) === "*") continue;
          for (const { original, local } of ref.pairs) {
            if (
              !isNamedBanned(
                ref.module,
                original,
                closure,
                allowlist,
                forwarded,
              )
            ) {
              continue;
            }
            // Re-read on every iteration — a single statement re-exporting
            // TWO banned names must not have the first one's freshly-created
            // set clobbered by a stale local capture on the second.
            const current = forwarded.get(file);
            const set = current instanceof Set ? current : new Set<string>();
            if (!set.has(local)) {
              set.add(local);
              forwarded.set(file, set);
              changed = true;
            }
          }
        }
      }
    }
  }
  return forwarded;
}

// ── violation scan ──────────────────────────────────────────────────────

export interface Violation {
  file: string;
  line: number;
  message: string;
}

export function findViolations(
  entries: FileRefs[],
  closure: ReadonlySet<string>,
  allowlist: ReadonlyMap<string, ReadonlySet<string>>,
  forwarded: ReadonlyMap<string, Forward>,
): Violation[] {
  const violations: Violation[] = [];
  for (const { file, refs } of entries) {
    for (const ref of refs) {
      if (isWholeModuleForm(ref.form)) {
        if (isWholeBanned(ref.module, closure, forwarded)) {
          violations.push({
            file,
            line: ref.line,
            message: `${ref.form} of pipeline pm→markdown module ${ref.module} — read it through src/utils/editor/serialize-live-doc.ts instead`,
          });
        }
        continue;
      }
      for (const { original, local } of ref.pairs) {
        if (
          isNamedBanned(ref.module, original, closure, allowlist, forwarded)
        ) {
          const as = local !== original ? ` (as ${local})` : "";
          violations.push({
            file,
            line: ref.line,
            message: `"${original}"${as} from ${ref.module} is not on the neutral-export allowlist — read it through src/utils/editor/serialize-live-doc.ts instead`,
          });
        }
      }
    }
  }
  return violations;
}
