// §361 — every theme mutation the settings UI starts (spec 0049 §10), mirroring the shape
// `usePluginActions.ts` gave the plugin marketplace: install with a consent gate, an
// in-flight guard before the first await, and one place that owns the source-based branch
// removal needs — `theme-gallery.tsx` and `ThemeBrowser.tsx` call `removeTheme`/
// `handleInstall` without ever comparing `theme.source` themselves (theme-sources.ts's
// whole point).
//
// Unlike plugins, a theme carries no `capabilities` (spec §9.3), so there is no escalation
// question on update and no per-capability list to show — the consent is three fixed
// sentences, asked once, ever (see `showConsentHistory` below for why "history" for a theme
// is a single entry rather than a list).
import { useCallback, useEffect, useRef, useState } from "react";

import type { Translate } from "../../../i18n/useTranslation";
import type { RegistryEntry } from "../../../plugins/types";
import type {
  InstalledTheme,
  ThemeInstallResult,
} from "../../../themes/theme-install";
import type { ThemeDef } from "../../../types/theme";
import type { ThemeCssErrorCode } from "../../../utils/theme-css/errors";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { themeUninstall } from "../../../ipc/theme";
import { useSettingsStore } from "../../../stores/settings/store";
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
        const consented = await askConsent(entry);
        if (!consented) return false;

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
            return false;
          }
          setInstallErrors((prev) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [entry.id]: _removed, ...rest } = prev;
            return rest;
          });

          const previousActiveThemeId =
            useSettingsStore.getState().activeThemeId;
          addInstalledTheme(result.installed);
          setActiveTheme(result.installed.id);
          useUIStore.getState().showToast(
            t("settings.appearance.installedToast", {
              name: result.installed.manifest.name,
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
          setInstalling((prev) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [entry.id]: _removed, ...rest } = prev;
            return rest;
          });
        }
      } finally {
        inFlight.current.delete(entry.id);
      }
    },
    [addInstalledTheme, askConsent, setActiveTheme, t],
  );

  /**
   * Remove a theme — what "remove" means depends on `theme.source`, decided HERE so
   * `theme-gallery.tsx` only ever calls this one function (its own `themeActions(source)`
   * gate already decides WHETHER to show a remove control at all).
   *
   * A failed uninstall leaves the record, same order as the plugin marketplace's
   * `handleUninstall`: a user clicking remove wants an error, not a record that silently
   * claims the theme is gone while the directory is still on disk.
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
        logger.error("[Theme] uninstall failed:", err);
        return;
      }
      removeInstalledTheme(theme.id);
    },
    [deleteCustomTheme, removeInstalledTheme],
  );

  /**
   * §10.3's `consentHistory` affordance for `themeActions("community")`.
   *
   * Not a growing list — a theme has no capabilities to escalate, so the three fixed
   * sentences never change between versions, and `installedAt` is the only moment consent
   * was ever asked. "History" here means "what you agreed to, and when," shown once.
   */
  const showConsentHistory = useCallback(
    (installed: InstalledTheme): void => {
      const date = new Date(installed.installedAt).toLocaleString(undefined);
      void showAlert(
        [
          t("settings.appearance.consentHistoryIntro", {
            date,
            version: installed.manifest.version,
          }),
          t("settings.appearance.installConsent.appearance"),
          t("settings.appearance.installConsent.noCode"),
          t("settings.appearance.installConsent.noNetwork"),
        ].join(" "),
      );
    },
    [t],
  );

  return {
    handleInstall,
    installErrors,
    installing,
    pendingConsent,
    removeTheme,
    settleConsent,
    showConsentHistory,
  };
}
