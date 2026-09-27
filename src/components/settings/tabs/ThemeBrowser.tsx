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
// `index.json` has no `kind: "theme"` entry yet (spec 0063 — the first theme is published by
// 6b-2). This screen is tested against fixtures; it renders whatever the registry gives it.
import { useCallback, useEffect, useState } from "react";

import type { RegistryEntry, RegistryIndex } from "../../../plugins/types";

import { ArrowLeft } from "lucide-react";

import { useTranslation } from "../../../i18n/useTranslation";
import {
  fetchRegistryIndex,
  searchThemeRegistry,
} from "../../../plugins/registry-client";
import { useSettingsStore } from "../../../stores/settings/store";
import { usePluginStore } from "../../../stores/system/plugin";
import { registryPreviewPalettes } from "../../../themes/theme-preview-palette";
import { ThemePreview } from "./theme-preview";
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
  // 0090 final review (N5) — a card for something already installed used to read "Install"
  // like every other. With N2 keeping the freshly-given consent, clicking it re-asks and
  // re-downloads a theme the user already has, and nothing on screen said so beforehand.
  const installedThemes = useSettingsStore((s) => s.installedThemes);

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

  // ‼️ STABLE, not fresh arrows (external review #11). `ThemeConsentDialog`'s Escape effect
  // depends on `onCancel`, and this component re-renders on every keystroke in its search
  // box — so a fresh arrow made the dialog detach and re-attach a `window` listener per
  // keystroke while it was open. It could not drop a key (React flushes a commit's passive
  // cleanups and setups in one synchronous job, and the old listener closes over the same
  // `settleConsent`), so this is waste rather than a defect — but it is waste on the one
  // surface whose whole job is to be dependable. `settleConsent` is `useCallback(…, [])`.
  const onCancelConsent = useCallback(
    () => settleConsent(false),
    [settleConsent],
  );
  const onConfirmConsent = useCallback(
    () => settleConsent(true),
    [settleConsent],
  );

  const consentDialog = pendingConsent && (
    <ThemeConsentDialog
      name={pendingConsent.name}
      onCancel={onCancelConsent}
      onConfirm={onConfirmConsent}
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
          <ArrowLeft className="icon-inline" size="1em" />{" "}
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
              installedFromFile={installedThemes[entry.id]?.origin === "file"}
              installedVersion={installedThemes[entry.id]?.manifest.version}
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
  installedFromFile,
  installedVersion,
  installing,
  onInstall,
}: {
  entry: RegistryEntry;
  error: string | undefined;
  /** 같은 id 의 설치본이 파일에서 왔다 — 스펙 0063 §4 */
  installedFromFile: boolean;
  /** The version of this theme already on disk, if any (0090 final review, N5). */
  installedVersion: string | undefined;
  installing: boolean;
  onInstall: () => void;
}) {
  const { t } = useTranslation();
  // Three states, and the middle one is the point: "installed" and "installed at another
  // version" want different words, because only the second is an action worth taking from
  // this screen. Updating from the gallery's own badge is the ordinary path; this button
  // reinstalls, which is why it says so rather than saying "Update".
  // 넷째 — 같은 id 가 파일에서 왔다: 이 버튼은 그 사본을 레지스트리 패키지로 바꾸므로
  // 그렇게 말한다(스펙 0063 §4, 확인은 `handleInstall`).
  const isInstalled = installedVersion !== undefined;
  const isSameVersion = installedVersion === entry.version;
  // `entry.preview` is typed structurally in `plugins/types.ts` (that file cannot import
  // `PreviewPalettes` — see its doc comment), so this re-runs the one validator
  // `normalizeIndex` already ran to get an honest `PreviewPalettes | undefined` without a cast.
  const palettes = registryPreviewPalettes(entry.preview);
  return (
    <div className="theme-browser-card">
      {palettes !== undefined && <ThemePreview palettes={palettes} />}
      <div className="theme-browser-card-info">
        <div className="theme-browser-card-name">
          {entry.name}
          <span className="theme-browser-card-version">v{entry.version}</span>
        </div>
        <p className="theme-browser-card-description">{entry.description}</p>
        <span className="theme-browser-card-author">{entry.author}</span>
        {isInstalled && (
          <span className="theme-browser-card-installed">
            {installedFromFile
              ? t("settings.appearance.themeBrowser.installedFromFile")
              : isSameVersion
                ? t("settings.appearance.themeBrowser.installed")
                : t("settings.appearance.themeBrowser.installedOther", {
                    version: installedVersion,
                  })}
          </span>
        )}
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
          : installedFromFile
            ? t("settings.appearance.themeBrowser.replace")
            : isInstalled
              ? t("settings.appearance.themeBrowser.reinstall")
              : t("settings.appearance.themeBrowser.install")}
      </button>
    </div>
  );
}
