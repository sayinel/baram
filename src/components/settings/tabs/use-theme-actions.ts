// §361 — every theme mutation the settings UI starts (spec 0049 §10), mirroring the shape
// `usePluginActions.ts` gave the plugin marketplace: install with a consent gate, an
// in-flight guard before the first await, and one place that owns the source-based branch
// removal needs — `theme-gallery.tsx` and `ThemeBrowser.tsx`/`ThemeConsentDialog.tsx` call
// `removeTheme`/`handleInstall` without ever comparing `theme.source` themselves
// (theme-sources.ts's whole point).
//
// Unlike plugins, a theme carries no `capabilities` (spec §9.3), so there is no escalation
// question on update and no per-capability list to show — the consent is three fixed
// sentences, asked once, ever (see `showConsentHistory` below for why "history" for a theme
// is a single entry rather than a list).
import { useCallback, useEffect, useRef, useState } from "react";

import type { Translate } from "../../../i18n/useTranslation";
import type { RegistryEntry, RegistryIndex } from "../../../plugins/types";
import type {
  InstalledTheme,
  ThemeInstallResult,
} from "../../../themes/theme-install";
import type { ThemeDef } from "../../../types/theme";
import type { ThemeCssErrorCode } from "../../../utils/theme-css/errors";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { themeUninstall } from "../../../ipc/theme";
import { unmetFloorAgainstApp } from "../../../plugins/engines-app";
import { themeUpdatesFor } from "../../../plugins/registry-client";
import { revocationFor, revocationReason } from "../../../plugins/revocation";
import { useSettingsStore } from "../../../stores/settings/store";
import { usePluginStore } from "../../../stores/system/plugin";
import { useThemeCssCacheStore } from "../../../stores/system/theme-css-cache";
import { useUIStore } from "../../../stores/ui/ui";
import { installTheme } from "../../../themes/theme-install";
import { showAlert } from "../../../utils/confirm-dialog";
import { logger } from "../../../utils/logger";
import {
  THEME_CSS_ERROR_CODES,
  themeCssErrorKey,
} from "../../../utils/theme-css/errors";

/** What the consent dialog is currently asking about, if anything. */
export interface PendingThemeConsent {
  entry: RegistryEntry;
}

/**
 * §9.3's three fixed sentences, translated — the single home for them.
 * `ThemeConsentDialog.tsx` and `showConsentHistory` below both call this instead of each
 * spelling out the three `t(...)` calls, which is what fix round 1 did and
 * is exactly the duplicated-predicate shape F7 fixed one file over
 * (`registry-client.ts`'s `matchesQuery`): a sentence added or reworded in one call site
 * and not the other would silently show the install-time gate and the after-the-fact
 * recall different copy for the same three-sentence disclosure.
 *
 * Also the theme-domain counterpart of `consentCovers` for
 * `src/utils/security-surfaces.ts`'s effect scan — see that file's header comment
 * ("보안 표면"의 정의는 이름이 아니라 효과다) for why a shared named function, not a
 * filename, is what the scan keys on.
 */
export function themeConsentSentences(t: Translate): string[] {
  return [
    t("settings.appearance.installConsent.appearance"),
    t("settings.appearance.installConsent.noCode"),
    t("settings.appearance.installConsent.noNetwork"),
  ];
}

/**
 * Derived from {@link THEME_CSS_ERROR_CODES} rather than typed out again — a second literal
 * list is exactly what goes stale the next time a code is added (the same reasoning that
 * array's own doc comment gives for being an array rather than only a type).
 */
const THEME_CSS_ERROR_CODES_SET: ReadonlySet<string> = new Set(
  THEME_CSS_ERROR_CODES,
);

/**
 * Turn a failed {@link ThemeInstallResult} into one locale sentence.
 *
 * `cssRejected` prefers the specific CSS rejection reason (`themeCssErrorKey`, the same
 * sentences the install pipeline already has strings for) when `detail` is one of its
 * codes — `installTheme`'s doc comment says `detail` carries the `ThemeCssError` code
 * exactly for this. Every other reason gets a generic sentence; `manifestInvalid`'s
 * field-level `errors` go to the log only, matching how the plugin install path treats a
 * rejected manifest (a user cannot fix a registry-published theme's manifest either way).
 */
export function installFailureMessage(
  result: Extract<ThemeInstallResult, { ok: false }>,
  t: Translate,
): string {
  if (
    result.reason === "cssRejected" &&
    result.detail !== undefined &&
    THEME_CSS_ERROR_CODES_SET.has(result.detail)
  ) {
    return t(themeCssErrorKey(result.detail as ThemeCssErrorCode));
  }
  // M1/M2 — the two reasons whose sentence needs the value that caused it. `detail` is the
  // floor and the id respectively (`installTheme` sets both), and the fallback empty string
  // is unreachable from that function: both arms set `detail` on the same line as `reason`.
  // Spelled anyway rather than asserted, because `detail` is optional in the type and a
  // `{required}` placeholder rendered literally is worse than an empty one.
  if (result.reason === "appTooOld" || result.reason === "reservedId") {
    return t(`settings.appearance.installError.${result.reason}`, {
      id: result.detail ?? "",
      required: result.detail ?? "",
    });
  }
  return t(`settings.appearance.installError.${result.reason}`);
}

export function useThemeActions() {
  const { t } = useTranslation();
  const {
    addInstalledTheme,
    deleteCustomTheme,
    removeInstalledTheme,
    setActiveTheme,
  } = useSettingsStore(
    useShallow((s) => ({
      addInstalledTheme: s.addInstalledTheme,
      deleteCustomTheme: s.deleteCustomTheme,
      removeInstalledTheme: s.removeInstalledTheme,
      setActiveTheme: s.setActiveTheme,
    })),
  );
  // §69's withdrawal list. It lives in the PLUGIN store because that is where the fetch and
  // the monotonic counter live (`revocation-client.ts`); it is not plugin-only data — the
  // entries carry no `kind` at all (`themes/theme-revocation.ts`'s header).
  const revocations = usePluginStore((s) => s.revocations);
  const clearThemeCssCache = useThemeCssCacheStore((s) => s.clearTheme);

  // §260 Phase 5's shape, reused: the install flow awaits a decision, modelled as a promise
  // the user resolves. The resolver lives in a ref so settling it does not depend on a
  // re-render having happened first.
  const [pendingConsent, setPendingConsent] =
    useState<null | PendingThemeConsent>(null);
  const consentResolver = useRef<((v: boolean) => void) | null>(null);
  /** Entry ids with an install in flight — guards a double-click BEFORE the first await. */
  const inFlight = useRef<Set<string>>(new Set());
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installErrors, setInstallErrors] = useState<Record<string, string>>(
    {},
  );

  const askConsent = useCallback(
    (entry: RegistryEntry) =>
      new Promise<boolean>((resolve) => {
        // A second request while one is open would strand the first caller forever.
        consentResolver.current?.(false);
        consentResolver.current = resolve;
        setPendingConsent({ entry });
      }),
    [],
  );

  const settleConsent = useCallback((value: boolean) => {
    setPendingConsent(null);
    consentResolver.current?.(value);
    consentResolver.current = null;
  }, []);

  // A dialog that disappears with the component (Settings closing mid-prompt) must resolve
  // as a REFUSAL — see usePluginActions.ts's identical guard for the reported defect.
  useEffect(
    () => () => {
      consentResolver.current?.(false);
      consentResolver.current = null;
    },
    [],
  );

  /**
   * §69's install-time refusal, for themes. True means "do not acquire this".
   *
   * Refused for ANY severity, exactly as `usePluginActions.handleInstall` does and for the
   * argument recorded there: a withdrawal always means "do not newly acquire this", while
   * only `malicious` is worth taking a working copy away from someone who already has it
   * (`themes/theme-revocation.ts` carries that second half). Newly installing a version
   * already known to be vulnerable, or merely withdrawn, has no upside to weigh against.
   *
   * ‼️ Resolved against the REGISTRY entry's version, not an installed record — this runs
   * before anything is downloaded, and on the update path the version at issue is the
   * target's, not the one already on disk.
   */
  const refuseIfRevoked = useCallback(
    (entry: RegistryEntry): boolean => {
      const blocked = revocationFor(entry.id, entry.version, revocations);
      if (blocked === null) return false;
      setInstallErrors((prev) => ({
        ...prev,
        [entry.id]: `${t("plugin.revoked.blockedInstall")} ${revocationReason(blocked, t)}`,
      }));
      return true;
    },
    [revocations, t],
  );

  /**
   * M1 — the `engines.baram` floor, against the LISTING, before anything is downloaded.
   *
   * Spec §9.1 lists the floor among the things themes reuse from §69, and until this round
   * nothing on the theme path called it: `validateThemeManifest` checks `engines.baram` is a
   * non-empty string and stops. A theme declaring `>=9.0.0` installed on 0.7.x in silence.
   *
   * Two-sided, the same shape `usePluginActions` uses: this judges the entry, and
   * `installTheme` re-judges the downloaded manifest. The entry is a claim; the archive is
   * the truth. This side exists to keep a pointless download off the wire and to refuse
   * before the consent dialog, so nobody approves an install that is already decided
   * against.
   *
   * Direction of doubt is `engines.ts`'s, unchanged: an absent floor, a grammar it cannot
   * parse, or an unreadable app version all mean "no opinion" and the install proceeds.
   */
  const refuseIfAppTooOld = useCallback(
    async (entry: RegistryEntry): Promise<boolean> => {
      const unmet = await unmetFloorAgainstApp(entry.engines);
      if (unmet === null) return false;
      setInstallErrors((prev) => ({
        ...prev,
        [entry.id]: t("settings.appearance.installError.appTooOld", {
          current: unmet.appVersion,
          required: unmet.floor,
        }),
      }));
      return true;
    },
    [t],
  );

  /**
   * Stage → hygiene → commit → record, shared by install and update.
   *
   * The consent gate is NOT here: install asks, update does not (see `handleUpdate`), and
   * folding the two would put that difference behind a boolean parameter where it is easy
   * to pass wrongly. What IS shared is everything that must not differ — the in-flight
   * badge, the failure-to-sentence mapping, the record write, and the cache invalidation.
   *
   * ‼️ The cache clear is unconditional on success rather than left to the update caller.
   * `use-theme-css-hydration.ts` will not re-read a key it already has, so a stale entry
   * keeps being applied over new bytes; making it the responsibility of whoever knows this
   * was "an update" is precisely the rule a third caller forgets (see `clearTheme`'s own
   * doc comment for what the two stale shapes look like).
   */
  const stageAndRecord = useCallback(
    async (
      entry: RegistryEntry,
      registryUrl: string,
      options?: { freshConsent?: boolean },
    ): Promise<InstalledTheme | null> => {
      setInstalling((prev) => ({ ...prev, [entry.id]: true }));
      try {
        const result = await installTheme(entry, registryUrl);
        if (!result.ok) {
          logger.error(
            "[Theme] install failed:",
            entry.id,
            result.reason,
            result.detail,
            result.errors,
          );
          setInstallErrors((prev) => ({
            ...prev,
            [entry.id]: installFailureMessage(result, t),
          }));
          return null;
        }
        setInstallErrors((prev) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [entry.id]: _removed, ...rest } = prev;
          return rest;
        });
        // Record first, then forget the old CSS: `addInstalledTheme` is what carries the
        // consent stamp forward on an update (its doc comment in `appearance-settings.ts`),
        // and the hydration hook re-reads on the next render either way.
        addInstalledTheme(result.installed, options);
        clearThemeCssCache(result.installed.id);
        // §367.3 — a second, "warning" toast next to whichever success toast the caller
        // (install or update) shows. It never blocks `installTheme`'s success above; this
        // only decides whether to ALSO say something about it.
        if (result.warnings !== undefined && result.warnings.length > 0) {
          useUIStore.getState().showToast(
            t("theme.install.contrastWarning", {
              count: String(result.warnings.length),
            }),
            "warning",
          );
        }
        return result.installed;
      } finally {
        setInstalling((prev) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [entry.id]: _removed, ...rest } = prev;
          return rest;
        });
      }
    },
    [addInstalledTheme, clearThemeCssCache, t],
  );

  /**
   * Install, apply immediately, and offer a free undo (spec §10.3 — a theme only has to
   * remember the one previous `activeThemeId`, which plugins cannot do).
   *
   * `activeThemeId` is read fresh via `getState()` at the moment of success rather than
   * closed over from render, so the "Undo" toast's target is whatever was active the
   * instant BEFORE this install applied — not whatever was active when the button was
   * clicked, which could be stale if this install itself took a while.
   */
  const handleInstall = useCallback(
    async (entry: RegistryEntry, registryUrl: string): Promise<boolean> => {
      if (inFlight.current.has(entry.id)) return false;
      inFlight.current.add(entry.id);
      try {
        // Before the dialog, not after: asking someone to approve an install that is
        // already decided against wastes the one decision this screen exists to collect.
        if (refuseIfRevoked(entry)) return false;
        if (await refuseIfAppTooOld(entry)) return false;
        const consented = await askConsent(entry);
        if (!consented) return false;

        // ‼️ `freshConsent`, because this path just ASKED (0090 final review, N2). It
        // matters only when a record already exists — reinstalling a theme you have — and
        // there the dialog the user just answered is the consent the record should carry.
        // `handleUpdate` deliberately omits it: it asks nothing, so it must keep the old
        // stamp.
        const installed = await stageAndRecord(entry, registryUrl, {
          freshConsent: true,
        });
        if (installed === null) return false;

        const previousActiveThemeId = useSettingsStore.getState().activeThemeId;
        setActiveTheme(installed.id);
        useUIStore.getState().showToast(
          t("settings.appearance.installedToast", {
            name: installed.manifest.name,
          }),
          "info",
          undefined,
          {
            label: t("settings.appearance.revertAction"),
            onClick: () => setActiveTheme(previousActiveThemeId),
          },
        );
        return true;
      } finally {
        inFlight.current.delete(entry.id);
      }
    },
    [
      askConsent,
      refuseIfAppTooOld,
      refuseIfRevoked,
      setActiveTheme,
      stageAndRecord,
      t,
    ],
  );

  /**
   * Update one installed theme to the version the registry now lists (spec §5.2's
   * `community` row, §10.2's badge).
   *
   * ‼️ THE LISTING IS RE-RESOLVED HERE, from the index, rather than trusted from the caller
   * — the shape of §260 Phase 5's H2 fix next door, where the Installed tab synthesised an
   * entry with `downloadUrl: ""` and an update from that tab destroyed the plugin every
   * time. Resolving through {@link themeUpdatesFor} rather than a hand-written `.find`
   * reuses ONE rule for "which entry updates this theme" (id, `kind === "theme"`, and a
   * version that differs), so the badge and the button can never disagree about what the
   * click will install.
   *
   * ‼️ NO CONSENT IS RE-ASKED, and that is a decision rather than an omission. A theme
   * carries no capability tuple (spec §9.3), so `consentRequired`'s escalation question —
   * the thing that would catch a hostile plugin update — has no theme analogue and could
   * never fire. What makes the silence acceptable is structural and not comfort: the
   * replacement CSS goes through the full hygiene pipeline again inside `installTheme`
   * (sanitize → inline → verify), and `applyThemeCss` verifies once more at injection, so
   * all three consent sentences hold for the new version exactly as they did for the old.
   * The guarantees are enforced per APPLY, not per version. If a path is ever added by
   * which a theme's CSS reaches the screen without the pipeline, this reasoning collapses
   * and re-consent becomes necessary.
   *
   * Returns whether the update landed.
   */
  const handleUpdate = useCallback(
    async (
      themeId: string,
      index: RegistryIndex,
      registryUrl: string,
    ): Promise<boolean> => {
      const installed = useSettingsStore.getState().installedThemes[themeId];
      if (installed === undefined) return false;
      const entry = themeUpdatesFor(index, { [themeId]: installed })[themeId];
      if (entry === undefined) return false;
      if (inFlight.current.has(entry.id)) return false;
      inFlight.current.add(entry.id);
      try {
        if (refuseIfRevoked(entry)) return false;
        if (await refuseIfAppTooOld(entry)) return false;
        const updated = await stageAndRecord(entry, registryUrl);
        if (updated === null) return false;
        useUIStore.getState().showToast(
          t("settings.appearance.updatedToast", {
            name: updated.manifest.name,
            version: updated.manifest.version,
          }),
          "info",
        );
        return true;
      } finally {
        inFlight.current.delete(entry.id);
      }
    },
    [refuseIfAppTooOld, refuseIfRevoked, stageAndRecord, t],
  );

  /**
   * Remove a theme — what "remove" means depends on `theme.source`, decided HERE so
   * `theme-gallery.tsx` only ever calls this one function (its own `themeActions(source)`
   * gate already decides WHETHER to show a remove control at all).
   *
   * A failed uninstall leaves the record, same order as the plugin marketplace's
   * `handleUninstall`: a user clicking remove wants an error, not a record that silently
   * claims the theme is gone while the directory is still on disk.
   *
   * ‼️ "Failed" no longer includes "the directory was already gone" (0090 final review, M3).
   * `uninstall_in` (`src-tauri/src/plugin/install.rs`) treats an absent install directory as
   * success, because the postcondition the user asked for already holds. While it refused,
   * a record whose directory had been lost — a crash between the disk delete and the store
   * write, a manual `rm`, a restored `config.json` — produced a card that could never be
   * removed by any sequence of clicks. That is the INVERSE of the orphan
   * `theme-store-fs.ts`'s header discusses and defers: that one is inert and self-healing;
   * this one was a dead end.
   */
  const removeTheme = useCallback(
    async (theme: ThemeDef): Promise<void> => {
      if (theme.source === "custom") {
        deleteCustomTheme(theme.id);
        return;
      }
      if (theme.source !== "community") return;
      try {
        await themeUninstall(theme.id);
      } catch (err) {
        // ‼️ SURFACED, NOT ONLY LOGGED (0090 final review, M3). The doc comment above has
        // said since §361 that "a user clicking remove wants an error"; until this round the
        // code delivered neither an error nor a removal — it logged and returned, leaving a
        // card whose Remove button did nothing visible. The same map the update path uses,
        // so the card already has a place to show it.
        logger.error("[Theme] uninstall failed:", err);
        setInstallErrors((prev) => ({
          ...prev,
          [theme.id]: t("settings.appearance.removeFailed"),
        }));
        return;
      }
      setInstallErrors((prev) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [theme.id]: _removed, ...rest } = prev;
        return rest;
      });
      removeInstalledTheme(theme.id);
      // The cached CSS text outlives the record otherwise, and installing the same id again
      // in this session would re-apply the bytes of the copy just deleted — `clearTheme`'s
      // doc comment has the mechanism.
      clearThemeCssCache(theme.id);
    },
    [clearThemeCssCache, deleteCustomTheme, removeInstalledTheme, t],
  );

  /**
   * §10.3's `consentHistory` affordance for `themeActions("community")`.
   *
   * Not a growing list — a theme has no capabilities to escalate, so the three fixed
   * sentences never change between versions, and there is exactly one consent moment ever.
   *
   * ‼️ Reads `consentedAt`/`consentedVersion`, NOT `installedAt`/`manifest.version` (review
   * round 1, F4). Those two pairs coincide today because this task only ever installs fresh,
   * but `installTheme`/`addInstalledTheme` also run on an UPDATE (Task 6), which legitimately
   * moves `installedAt` and `manifest.version` without asking again — reading those here
   * would have this screen assert a consent at a date and version nothing was ever agreed to.
   * `InstalledTheme.consentedAt`'s doc comment is the contract Task 6 must not break.
   * (Task 6 keeps it at the single writer — `addInstalledTheme` in `appearance-settings.ts`
   * carries both fields forward when a record for that id already exists.)
   *
   * ‼️ §361 Task 6 ruling — this screen stays in the LIGHT DOM, unlike the install consent
   * dialog (§359/§361 round 2 shadow-isolated that one). A hostile installed theme's CSS can
   * therefore hide or restyle it, and the reason that is acceptable is that nothing is
   * decided here: no gate, no action, no IPC. CSS cannot alter text, only hide it, and
   * `showAlert` renders the four sentences as one string, so the worst a theme achieves is a
   * blank recall dialog — which misleads nobody into granting anything, and is itself
   * conspicuous. The surface where a decision IS made is already isolated.
   *
   * What would overturn this: the moment this screen grows an action — "withdraw consent",
   * "uninstall from here" — it becomes a gate and has to move into `ShadowIsolated` like
   * `ThemeConsentDialog.tsx`.
   */
  const showConsentHistory = useCallback(
    (installed: InstalledTheme): void => {
      const date = new Date(installed.consentedAt).toLocaleString(undefined);
      void showAlert(
        [
          t("settings.appearance.consentHistoryIntro", {
            date,
            version: installed.consentedVersion,
          }),
          ...themeConsentSentences(t),
        ].join(" "),
      );
    },
    [t],
  );

  return {
    handleInstall,
    handleUpdate,
    installErrors,
    installing,
    pendingConsent,
    removeTheme,
    settleConsent,
    showConsentHistory,
  };
}
