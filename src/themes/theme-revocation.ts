// §361 Task 6 / spec 0049 §9.4 — what a withdrawal entry means for an INSTALLED theme.
//
// The decisions are `plugins/revocation.ts`'s and stay there: this module only aims them at
// a theme record, so the three surfaces that need the answer (`use-settings-effects.ts`'s
// enforcement, `theme-gallery.tsx`'s notice, `use-theme-actions.ts`'s install/update
// refusal) resolve it the same way instead of each writing
// `revocationFor(id, installedThemes[id]?.manifest.version, revocations)` again.
//
// ‼️ THE WITHDRAWAL LIST HAS NO `kind` FIELD (`RevocationEntry`), so a theme and a plugin
// share one id namespace here. That is coherent rather than sloppy: `registry-client.ts`'s
// `dropAmbiguousIds` makes an id claimed by two registry entries resolve to NEITHER, so the
// registry cannot publish a theme and a plugin under one id in the first place, and a
// withdrawal naming that id can only mean the one thing that exists. What this module does
// NOT do is guess — it resolves against the installed THEME records, so a withdrawal for a
// plugin id reaches no theme unless a theme of that id is installed.

import type { RevocationEntry, RevocationList } from "../plugins/revocation";
import type { InstalledTheme } from "./theme-install";

import { blocksLoad, revocationFor } from "../plugins/revocation";

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
  const installed = installedThemes[themeId];
  if (installed === undefined) return null;
  return revocationFor(themeId, installed.manifest.version, revocations);
}
