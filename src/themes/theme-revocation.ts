// §361 Task 6 / spec 0049 §9.4 — what a withdrawal entry means for an INSTALLED theme.
//
// The decisions are `plugins/revocation.ts`'s and stay there: this module only aims them at
// a theme record, so the three surfaces that need the answer (`use-settings-effects.ts`'s
// enforcement, `theme-gallery.tsx`'s notice, `use-theme-actions.ts`'s install/update
// refusal) resolve it the same way instead of each writing
// `revocationFor(id, installedThemes[id]?.manifest.version, revocations)` again.
//
// ‼️ THE WITHDRAWAL LIST HAS NO `kind` FIELD (`RevocationEntry`), so a theme and a plugin
// share one id namespace here. `registry-client.ts`'s `dropAmbiguousIds` makes an id claimed
// by two entries **of one index** resolve to NEITHER, so no single snapshot can offer a
// theme and a plugin under one id.
//
// ‼️ THAT IS A PER-SNAPSHOT PROPERTY, NOT A PERMANENT ONE (0090 final review, L2). An
// earlier version of this paragraph said the registry "cannot publish a theme and a plugin
// under one id in the first place", and that is false over time: install plugin `foo`, let
// the index later republish `foo` as a theme, install that, and both records exist while no
// index ever listed both. A withdrawal for `foo` then reaches both — which is the right
// outcome for a withdrawal and the wrong strength for that sentence.
//
// What this module does NOT do is guess: it resolves against the installed THEME records, so
// a withdrawal for a plugin id reaches no theme unless a theme of that id is installed.

import type { RevocationEntry, RevocationList } from "../plugins/revocation";
import type { InstalledTheme } from "./theme-install";

import { blocksLoad, revocationFor } from "../plugins/revocation";
import { RESERVED_THEME_IDS } from "../types/theme";

/**
 * 입을 수 있는 테마 id — 철회로 막힌 테마면 `"system"`, 그리고 철회가 그것을 정했는가.
 *
 * `useEffectiveThemeId`(`hooks/use-effective-theme-id.ts`)와 React 밖 읽기(`readEditorTypography`)가
 * **같은 계산**을 쓰려고 여기 있다 — 규칙의 근거는 그 훅의 머리주석이다.
 */
export function effectiveThemeIdOf(
  activeThemeId: string,
  installedThemes: Record<string, InstalledTheme>,
  revocations: null | RevocationList,
): { effectiveThemeId: string; forceDeactivated: boolean } {
  const forceDeactivated = themeBlocksApply(
    themeRevocationFor(activeThemeId, installedThemes, revocations),
  );
  return {
    effectiveThemeId: forceDeactivated ? "system" : activeThemeId,
    forceDeactivated,
  };
}

/**
 * Whether this theme must stop being applied — the same threshold `blocksLoad` sets for a
 * plugin, deliberately reusing that function rather than restating it.
 *
 * ‼️ Spec §9.4 reads "철회된 테마는 즉시 비활성화하고 `system`으로 되돌린 뒤 고지한다"
 * with no severity named, and taken at face value that would yank an `unlisted` theme —
 * a theme merely removed from the index, with no security claim attached — out from under
 * the user, i.e. treat themes MORE aggressively than malicious plugins. The sentence is
 * contrasting themes with plugins on the STATE axis (its next clause: a theme has no
 * "installed but disabled"), not lowering the threshold. So `malicious` deactivates;
 * `vulnerable` and `unlisted` keep applying and are surfaced instead.
 *
 * Calling `blocksLoad` rather than writing `severity === "malicious"` here is what keeps
 * the two in step: a third severity added to that ranking gets one decision, not two.
 */
export function themeBlocksApply(entry: null | RevocationEntry): boolean {
  return blocksLoad(entry);
}

/** The withdrawal governing an installed theme at the version actually on disk, or null
 *  for a theme that is not installed (built-in, custom, dev) or not withdrawn. */
export function themeRevocationFor(
  themeId: string,
  installedThemes: Record<string, InstalledTheme>,
  revocations: null | RevocationList,
): null | RevocationEntry {
  // ‼️ A RESERVED ID SPEAKS FOR NOBODY (0090 final review, M2). `installTheme` refuses these
  // now, but a record written by an earlier build can still be in the store, and that record
  // is inert: `findThemeById` resolves the id to the SHIPPED theme, so the installed copy
  // can never be worn. Answering a withdrawal for it would therefore decorate — and
  // force-deactivate — a built-in theme whose files are in the binary and which no registry
  // entry describes. Nothing is lost by staying silent: there is nothing applied to take off.
  if (RESERVED_THEME_IDS.has(themeId)) return null;
  const installed = installedThemes[themeId];
  if (installed === undefined) return null;
  return revocationFor(themeId, installed.manifest.version, revocations);
}
