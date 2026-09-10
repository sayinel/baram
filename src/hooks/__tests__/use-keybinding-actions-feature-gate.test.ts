// §338/I-6 — every registered keybinding whose id names a feature must gate on
// that feature, derived from source rather than hand-listed.
//
// The finding this guards against: `use-keybinding-actions.ts` had 39
// `registerAction` calls and exactly 1 feature gate (`aiReady()`, used by 4 of
// them). 6 more — 4 `zettelkasten.*` actions and 2 `journal.*` actions — either
// had no gate at all, or gated silently (a `logger.warn` with no user-facing
// toast, itself forbidden by §18.19 결함 A). A hand-written list of "the 6
// broken ones" is exactly what the NEXT feature-prefixed action would slip
// past, so this derives the call-site list from `registerAction(` calls
// instead (mirroring `nodeview-ai-menu-i18n.test.ts`'s technique for a
// different function).
//
// ‼️ One named exception exists, with a reason — not because the rule is
// wrong for it, but because gating it the naive way would be worse than not
// gating it. See EXCEPTIONS below. (`tasks.taskInput` was a second exception
// until `space.tasks.disabled` existed to gate it against — see
// use-keybinding-actions.ts and feature-gate.ts.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FEATURE_KEYS } from "../../stores/settings/feature-keys";

const ACTIONS_PATH = join("src", "hooks", "use-keybinding-actions.ts");
const REGISTRY_PATH = join("src", "keybindings", "keybinding-registry.ts");

/**
 * Feature-prefixed action ids that are deliberately NOT gated on
 * `featureReady`, with the reason each one is safe to leave that way.
 *
 * ‼️ Named, not silently skipped — an entry disappearing from
 * `use-keybinding-actions.ts` without this list shrinking is caught by
 * "every exception still exists" below.
 */
const EXCEPTIONS: Record<string, string> = {
  "journal.quickCapture":
    "A2 — capture is not exclusive to Journal or Tasks; this shortcut works regardless of either toggle (fix-d-brief.md A2).",
};

/** `export const NAME = "value";` pairs from the registry — resolves the one
 *  `registerAction` call site that passes an identifier (`TASK_INPUT_COMMAND`)
 *  instead of a string literal. */
interface RegisteredCall {
  /** Source text from this call's `registerAction(` through the character
   *  just before the NEXT call's `registerAction(` (or EOF for the last) —
   *  an approximation of "this handler's body", good enough to search for a
   *  substring in (not to parse). */
  body: string;
  id: string;
}

function parseRegisteredCalls(
  source: string,
  constants: Record<string, string>,
): RegisteredCall[] {
  const CALL_RE = /registerAction\(\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/g;
  const matches = [...source.matchAll(CALL_RE)];
  return matches.map((m, i) => {
    const literal = m[1];
    const identifier = m[2];
    const id = literal ?? constants[identifier ?? ""];
    if (id === undefined) {
      throw new Error(
        `use-keybinding-actions-feature-gate.test.ts could not resolve the id at ` +
          `registerAction call #${i} ("${m[0]}") — is a new identifier-form call ` +
          `missing from resolveConstants' source, or is it a typo?`,
      );
    }
    const start = m.index!;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : source.length;
    return { id, body: source.slice(start, end) };
  });
}

function resolveConstants(source: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of source.matchAll(
    /export const ([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]+)"/g,
  )) {
    map[m[1]!] = m[2]!;
  }
  return map;
}

const source = readFileSync(ACTIONS_PATH, "utf8");
const registrySource = readFileSync(REGISTRY_PATH, "utf8");
const calls = parseRegisteredCalls(source, resolveConstants(registrySource));

/** Calls whose id names one of the 4 features — the ones this rule binds. */
const featureCalls = calls.filter((c) =>
  FEATURE_KEYS.some((f) => c.id.startsWith(`${f}.`)),
);

describe("registerAction calls gate on their feature", () => {
  it("found the calls and the feature-prefixed subset, so the checks below are not vacuous", () => {
    // 39 registerAction calls at the time of writing; a floor, not an
    // equality, so a new call makes the NEXT assertions fail on their own
    // merits rather than this one.
    expect(calls.length).toBeGreaterThanOrEqual(39);
    // 7 at the time of writing: ai.chatPanel, ai.ghostText, ai.skillTest,
    // journal.quickCapture, journal.memories, journal.photoGallery,
    // zettelkasten.newNote/promote/newFromSelection/newMoc, tasks.taskInput.
    // ‼️ 실측 12 다(주석이 11개 id 를 나열하면서 "7" 이라고 적고 있었다 — 재리뷰
    // Minor g). 하한은 슬랙만큼만 가드다: 7 이면 다섯 자리가 조용히 사라져도 통과한다.
    expect(featureCalls.length).toBeGreaterThanOrEqual(12);
  });

  // ‼️ "featureReady 를 부른다"만으로는 **어느 기능으로** 부르는지 모른다 — 실측으로
  // 인자를 다른 기능으로 바꿔도 이 스캔은 초록이었다(재리뷰 Minor b). 그래서 id 접두사에서
  // 기대 인자를 **파생**시켜 함께 단정한다. 12개 중 키까지 고정돼 있던 것은 8개뿐이었고
  // `journal.openToday`·`journal.photoGallery`·`zettelkasten.promote`·
  // `zettelkasten.newFromSelection`·`zettelkasten.newMoc` 5개가 비어 있었다.
  //
  // ‼️ 이건 여전히 소스 스캔이므로 **가드가 옳은 자리에 있는지**는 못 본다(이른 return
  // 뒤에 있어도 통과한다). 그 층은 동작 테스트가 덮는다 — `journal.memories`·
  // `zettelkasten.newNote`·`tasks.taskInput`·`ai.*` 가 그것이고, 나머지는 아직 스캔뿐이다.
  it.each(featureCalls.filter((c) => !(c.id in EXCEPTIONS)))(
    "$id gates on the feature its id names",
    ({ id, body }) => {
      const feature = FEATURE_KEYS.find((f) => id.startsWith(`${f}.`));
      expect(feature, `no FeatureKey prefixes ${id}`).toBeDefined();
      expect({
        id,
        gatesOnOwnFeature: new RegExp(
          `featureReady\\(\\s*["']${feature}["']`,
        ).test(body),
      }).toEqual({ id, gatesOnOwnFeature: true });
    },
  );

  it("every named exception still exists as a real call site", () => {
    const ids = new Set(calls.map((c) => c.id));
    const stale = Object.keys(EXCEPTIONS).filter((id) => !ids.has(id));
    expect(stale).toEqual([]);
  });
});
