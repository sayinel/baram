// §361 ThemeBrowser — the theme marketplace's browse screen (spec 0049 §10.2).
//
// A registry LISTING screen only: it fetches the same index the plugin marketplace does and
// shows just the `kind: "theme"` rows (`registry-client.ts`'s `searchThemeRegistry` — the
// plugin marketplace's own `searchRegistry` hides these same rows the other way). Replaces
// the whole tab body while open, following AppearanceTab's routing convention, so the
// settings modal itself never closes (avoiding `PluginMarketplace.tsx`'s recorded problem
// of a detail view that has to close it).
//
// ‼️ Cannot be verified against the LIVE registry today — `sayinel/baram-plugins`'s
// `index.json` carries one entry with no `kind`, so no theme is published yet. This screen
// is tested against fixtures; it renders whatever the registry gives it.
import { useCallback, useEffect, useState } from "react";

import type { RegistryEntry, RegistryIndex } from "../../../plugins/types";

import { useTranslation } from "../../../i18n/useTranslation";
import {
  fetchRegistryIndex,
  searchThemeRegistry,
} from "../../../plugins/registry-client";
import { usePluginStore } from "../../../stores/system/plugin";
import { useThemeActions } from "./use-theme-actions";

interface ThemeBrowserProps {
  onBack: () => void;
}

export function ThemeBrowser({ onBack }: ThemeBrowserProps) {
  const { t } = useTranslation();
  const registryUrl = usePluginStore((s) => s.registryUrl);

  const [registryIndex, setRegistryIndex] = useState<null | RegistryIndex>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<null | string>(null);
  const [query, setQuery] = useState("");

  const {
    handleInstall,
    installErrors,
    installing,
    pendingConsent,
    settleConsent,
  } = useThemeActions();

  const load = useCallback((forceRefresh = false) => {
    setLoading(true);
    fetchRegistryIndex(forceRefresh)
      .then((index) => {
        setRegistryIndex(index);
        setFetchError(null);
      })
      .catch((err: unknown) => setFetchError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const entries = registryIndex
    ? searchThemeRegistry(registryIndex, query)
    : [];

  const consentDialog = pendingConsent && (
    <ThemeConsentDialog
      name={pendingConsent.entry.name}
      onCancel={() => settleConsent(false)}
      onConfirm={() => settleConsent(true)}
    />
  );

  return (
    <div className="theme-browser">
      {consentDialog}
      <div className="theme-browser-header">
        <button
          className="btn-unstyled theme-browser-back"
          onClick={onBack}
          type="button"
        >
          {t("settings.appearance.themeBrowser.back")}
        </button>
        <h3 className="theme-browser-title">
          {t("settings.appearance.themeBrowser.title")}
        </h3>
        <button
          className="theme-action-btn"
          disabled={loading}
          onClick={() => load(true)}
          type="button"
        >
          {loading
            ? t("settings.appearance.themeBrowser.loading")
            : t("settings.appearance.themeBrowser.refresh")}
        </button>
      </div>

      <input
        className="theme-browser-search"
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("settings.appearance.themeBrowser.search")}
        type="text"
        value={query}
      />

      {fetchError !== null && !loading && (
        <div className="theme-browser-error" role="alert">
          <p>{t("settings.appearance.themeBrowser.registryFailed")}</p>
          <button
            className="theme-action-btn"
            onClick={() => load(true)}
            type="button"
          >
            {t("settings.appearance.themeBrowser.retry")}
          </button>
        </div>
      )}

      {loading && registryIndex === null && (
        <div className="theme-browser-empty">
          {t("settings.appearance.themeBrowser.loading")}
        </div>
      )}

      {!loading && fetchError === null && entries.length === 0 && (
        <div className="theme-browser-empty">
          {query
            ? t("settings.appearance.themeBrowser.emptySearch")
            : t("settings.appearance.themeBrowser.emptyRegistry")}
        </div>
      )}

      {entries.length > 0 && (
        <div className="theme-browser-list">
          {entries.map((entry) => (
            <ThemeBrowserCard
              entry={entry}
              error={installErrors[entry.id]}
              installing={installing[entry.id] === true}
              key={entry.id}
              onInstall={() => void handleInstall(entry, registryUrl)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Browser Card ───────────────────────────────────────

function ThemeBrowserCard({
  entry,
  error,
  installing,
  onInstall,
}: {
  entry: RegistryEntry;
  error: string | undefined;
  installing: boolean;
  onInstall: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="theme-browser-card">
      <div className="theme-browser-card-info">
        <div className="theme-browser-card-name">
          {entry.name}
          <span className="theme-browser-card-version">v{entry.version}</span>
        </div>
        <p className="theme-browser-card-description">{entry.description}</p>
        <span className="theme-browser-card-author">{entry.author}</span>
        {error !== undefined && (
          <div className="theme-browser-card-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <button
        className="theme-action-btn"
        disabled={installing}
        onClick={onInstall}
        type="button"
      >
        {installing
          ? t("settings.appearance.themeBrowser.installing")
          : t("settings.appearance.themeBrowser.install")}
      </button>
    </div>
  );
}

// ─── Consent Dialog ─────────────────────────────────────

/**
 * §9.3's three fixed sentences — a theme has no `capabilities`, so there is nothing to list
 * per-capability the way `PluginConsentDialog` does, and no `ShadowIsolated` portal either:
 * §8's `@layer baram-theme` guarantee already keeps ANY installed theme's CSS from
 * outranking unlayered app chrome (spec 0049 §8, test C-11), which is the same threat
 * `ShadowIsolated` exists to close for a plugin's own styling. Nothing is installed yet at
 * the moment this dialog is open, in any case — only an ALREADY-installed theme's CSS could
 * be live, and that guarantee already covers it.
 *
 * ‼️ The third sentence ("makes no network connection") is true only because 0089 made it
 * STRUCTURALLY true — stored CSS carries no URL other than `data:` (`inlineThemeAssets`
 * turns every reference into one before anything is stored). If any 0089 layer is ever
 * loosened, this sentence becomes false and nothing here would notice — it is asserted as
 * copy, not re-verified per install.
 */
function ThemeConsentDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="theme-consent-backdrop">
      <div aria-modal="true" className="theme-consent" role="dialog">
        <h3 className="theme-consent-title">
          {t("settings.appearance.installConsent.title", { name })}
        </h3>
        <ul className="theme-consent-list">
          <li>{t("settings.appearance.installConsent.appearance")}</li>
          <li>{t("settings.appearance.installConsent.noCode")}</li>
          <li>{t("settings.appearance.installConsent.noNetwork")}</li>
        </ul>
        <div className="theme-consent-actions">
          <button
            className="btn-unstyled theme-consent-cancel"
            onClick={onCancel}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="theme-consent-confirm"
            onClick={onConfirm}
            type="button"
          >
            {t("settings.appearance.installConsent.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
