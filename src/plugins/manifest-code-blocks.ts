// §394 spec 0073 D4 · D5 · §4 — `contributions.codeBlocks` and the `codeblocks` capability. A file
// of its own for the reason `manifest-entry-points.ts` is one: `manifest.ts` is past 600 lines. The
// checks come in from `validateContributions` / `validateManifest`, which own the error list.

import type { ContributionChecks } from "./manifest-entry-points";
import type { PluginManifest } from "./types";

import { HIGHLIGHTED_LANGUAGE_NAMES } from "../extensions/nodes/highlighted-language-names";

/** §4 — languages one plugin may declare. */
export const MAX_CODE_BLOCKS = 10;

/** D5 — a language a plugin may name: what the fence input rule can type (`[a-z0-9-]`), bounded. */
export const CODE_BLOCK_LANG = /^[a-z0-9][a-z0-9-]{0,31}$/u;

/**
 * D5 — the fenced languages Baram routes to nodes of its own at parse time (`CODE_LANG_MAP` in
 * `pipeline/md-to-pm.ts`; `manifest-code-blocks.test.ts` holds the two together). The `journal-`
 * prefix is the code block NodeView's own branch and is checked separately.
 */
export const BUILTIN_CODE_BLOCK_LANGS: ReadonlySet<string> = new Set([
  "mermaid",
  "query",
  "svg",
]);

const JOURNAL_PREFIX = "journal-";

/**
 * §4 — the capability and the declaration come together: a declaration without `codeblocks` would
 * show the user nothing about it, and the capability without a language draws nothing.
 */
export function checkCodeBlockCapability(
  capabilities: unknown,
  contributions: unknown,
  report: (field: string, message: string) => void,
): void {
  if (!Array.isArray(capabilities)) return; // reported by the capabilities check
  const held = capabilities.includes("codeblocks");
  const list =
    typeof contributions === "object" &&
    contributions !== null &&
    !Array.isArray(contributions)
      ? (contributions as Record<string, unknown>).codeBlocks
      : undefined;
  const declares = Array.isArray(list) && list.length > 0;
  if (declares && !held) {
    report(
      "capabilities",
      'contributions.codeBlocks needs the "codeblocks" capability — the install dialog has to be able to say so',
    );
  }
  if (held && !declares) {
    report(
      "contributions.codeBlocks",
      'the "codeblocks" capability needs at least one language in contributions.codeBlocks',
    );
  }
}

/**
 * The languages a manifest may claim: none without `codeblocks` (a consent that narrowed the
 * capability away claims nothing), else its declared languages, sorted, each once.
 */
export function declaredCodeBlockLangs(
  manifest: Pick<PluginManifest, "capabilities" | "contributions">,
): string[] {
  if (!manifest.capabilities.includes("codeblocks")) return [];
  const langs = (manifest.contributions?.codeBlocks ?? []).map((b) => b.lang);
  return [...new Set(langs)].sort();
}

/** D5 · §4 — `contributions.codeBlocks`: objects, capped, each `lang` well-formed, unclaimed by Baram, once. */
export function validateCodeBlocks(check: ContributionChecks): void {
  const list = check.entries("codeBlocks");
  if (!list) return;
  if (list.length > MAX_CODE_BLOCKS) {
    check.report(
      "contributions.codeBlocks",
      `at most ${MAX_CODE_BLOCKS} codeBlocks may be declared`,
    );
  }
  const seen = new Set<string>();
  list.forEach((entry, i) => {
    const field = `contributions.codeBlocks[${i}].lang`;
    const lang = entry.lang;
    if (typeof lang !== "string" || !CODE_BLOCK_LANG.test(lang)) {
      check.report(field, `${field} must match ${CODE_BLOCK_LANG.source}`);
      return;
    }
    if (BUILTIN_CODE_BLOCK_LANGS.has(lang) || lang.startsWith(JOURNAL_PREFIX)) {
      check.report(field, `${field} "${lang}" is drawn by Baram itself`);
    } else if (HIGHLIGHTED_LANGUAGE_NAMES.has(lang)) {
      check.report(
        field,
        `${field} "${lang}" is a language Baram highlights — a renderer for it would replace every such code block`,
      );
    }
    if (seen.has(lang)) check.report(field, `duplicate lang "${lang}"`);
    seen.add(lang);
  });
}
