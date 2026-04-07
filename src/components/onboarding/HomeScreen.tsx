import { useCallback } from "react";

import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";

interface HomeScreenProps {
  onNewFile: () => void;
  onNewVault: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenRecentFile: (path: string) => void;
  onOpenRecentFolder: (path: string) => void;
}

export function HomeScreen({
  onNewFile,
  onNewVault,
  onOpenFile,
  onOpenFolder,
  onOpenRecentFolder,
  onOpenRecentFile,
}: HomeScreenProps) {
  const { t } = useTranslation();
  const recentFolders = useSettingsStore((s) => s.recentFolders);
  const recentFiles = useSettingsStore((s) => s.recentFiles);

  const timeAgo = useCallback(
    (ts: number): string => {
      const diff = Date.now() - ts;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return t("home.justNow");
      if (mins < 60) return t("home.minutesAgo", { count: String(mins) });
      const hours = Math.floor(mins / 60);
      if (hours < 24) return t("home.hoursAgo", { count: String(hours) });
      const days = Math.floor(hours / 24);
      return t("home.daysAgo", { count: String(days) });
    },
    [t],
  );

  return (
    <div className="home-screen">
      <div className="home-card">
        <h1 className="home-title">Baram</h1>
        <p className="home-tagline">{t("home.tagline")}</p>

        <div className="home-actions">
          <button className="home-btn home-btn-primary" onClick={onOpenFolder}>
            {t("home.openFolder")}
          </button>
          <button className="home-btn home-btn-secondary" onClick={onNewVault}>
            {t("home.newVault")}
          </button>
          <button className="home-btn home-btn-secondary" onClick={onOpenFile}>
            {t("home.openFile")}
          </button>
          <button className="home-btn home-btn-secondary" onClick={onNewFile}>
            {t("home.newFile")}
          </button>
        </div>

        {recentFolders.length > 0 && (
          <div className="home-recent">
            <h3 className="home-recent-title">{t("home.recentFolders")}</h3>
            <ul className="home-recent-list">
              {recentFolders.map((f) => (
                <li key={f.path}>
                  <button
                    className="home-recent-item"
                    onClick={() => onOpenRecentFolder(f.path)}
                    title={f.path}
                  >
                    <span className="home-recent-icon">📁</span>
                    <span className="home-recent-path">
                      {f.path.split("/").pop()}
                    </span>
                    <span className="home-recent-time">
                      {timeAgo(f.lastOpened)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {recentFiles.length > 0 && (
          <div className="home-recent">
            <h3 className="home-recent-title">{t("home.recentFiles")}</h3>
            <ul className="home-recent-list">
              {recentFiles.map((f) => (
                <li key={f.path}>
                  <button
                    className="home-recent-item"
                    onClick={() => onOpenRecentFile(f.path)}
                    title={f.path}
                  >
                    <span className="home-recent-icon">📄</span>
                    <span className="home-recent-path">
                      {f.path.split("/").pop()}
                    </span>
                    <span className="home-recent-time">
                      {timeAgo(f.lastOpened)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="home-shortcuts">
          <span>
            <kbd>⌘</kbd>
            <kbd>⇧</kbd>
            <kbd>O</kbd> {t("home.shortcut.openFolder")}
          </span>
          <span>
            <kbd>⌘</kbd>
            <kbd>N</kbd> {t("home.shortcut.newFile")}
          </span>
          <span>
            <kbd>⌘</kbd>
            <kbd>P</kbd> {t("home.shortcut.commandPalette")}
          </span>
        </div>
      </div>
    </div>
  );
}
