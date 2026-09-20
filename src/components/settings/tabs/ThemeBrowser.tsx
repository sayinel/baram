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
import { ThemeConsentDialog } from "./ThemeConsentDialog";
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
