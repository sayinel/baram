// §361 Task 6 / spec 0049 §9.4 — a theme the registry has withdrawn as MALICIOUS stops
// being applied, and the app falls back to `system`.
//
// ‼️ COMPUTED DURING RENDER AND USED BY THE APPLY EFFECT, THE HYDRATION HOOK, AND THE
// DIAL LAYER (`use-theme-dials.ts`), rather than fixed afterwards by an effect that
// writes the store. The store write happens too
// (`use-settings-effects.ts` — `activeThemeId` has to stop naming a theme that must not be
// worn), but the derived id is what keeps the withdrawn theme from ever reaching `<html>`.
//
// Measured on this branch (2026-09-20), because the first version of this comment guessed
// and guessed wrong. Reverting to the effect-only shape — every reader on `activeThemeId` —
// does NOT leave a `<style>` behind for a commit, because the store revert re-runs the apply
// effect and its first line is `clearThemeVars`. What it does is write the withdrawn theme's
// colours to `<html>` and take them off again inside one update, which the DOM cannot be
// asked about afterwards. `applyThemeVars` being called at all is the observable difference,
// and that is what `use-settings-effects-theme-revoked.test.tsx` records. The stored CSS is
// the plainer half: with the derived id the hydration hook never asks the disk for it.
//
// Only `malicious` — `themeBlocksApply` is `blocksLoad`, and that file carries the reading
// of §9.4 that makes it so.
//
// ‼️ §9.4 SAYS "즉시", AND THAT IS NOT "BEFORE FIRST PAINT" (0090 final review, L6). This
// reads `revocations` out of the PLUGIN store, which is `null` until that store's async
// persist hydration lands; the settings store hydrates independently and can land first.
// When it does, a withdrawn theme's CSS paints until the plugin store arrives or
// `refreshRevocations` returns — milliseconds, but real. Plugins do not have this window:
// `plugin-lifecycle.ts` waits on the bounded refresh before loading any of them.
//
// Left as it is, on purpose. The exposure is cosmetic rather than structural, because
// those bytes went through the hygiene pipeline and are re-verified at injection — no
// code, no network, no `!important` reaching a security surface. Closing it would mean
// holding the whole theme layer behind another store's hydration, which trades a
// guaranteed unstyled flash for every launch against milliseconds in the rare one. What
// must not happen is someone reading §9.4's "즉시" as a pre-paint guarantee: it is
// "as soon as the withdrawal is known", and this is where "known" is decided.

import { useShallow } from "zustand/shallow";

import { useSettingsStore } from "../stores/settings/store";
import { usePluginStore } from "../stores/system/plugin";
import { effectiveThemeIdOf } from "../themes/theme-revocation";

/**
 * The theme id the app may actually wear, plus whether a withdrawal is what decided it.
 *
 * Both halves are returned because both have callers: `use-theme-dials.ts` wants only the
 * id (a withdrawn theme must not keep dictating the body width after its colours are gone),
 * while `use-settings-effects.ts` needs `forceDeactivated` for the store revert and the
 * one-shot toast.
 */
export function useEffectiveThemeId(): {
  effectiveThemeId: string;
  forceDeactivated: boolean;
} {
  const { activeThemeId, installedThemes } = useSettingsStore(
    useShallow((s) => ({
      activeThemeId: s.activeThemeId,
      installedThemes: s.installedThemes,
    })),
  );
  const revocations = usePluginStore((s) => s.revocations);
  return effectiveThemeIdOf(activeThemeId, installedThemes, revocations);
}
