// §4.9 Welcome Screen — 첫 실행 시 에디터 영역에 표시
import { useState } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useTranslation } from "../../i18n/useTranslation";

interface WelcomeScreenProps {
  onNewFile: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
}

export function WelcomeScreen({ onNewFile, onOpenFile, onOpenFolder }: WelcomeScreenProps) {
  const { dismissWelcome } = useUIStore();
  const { t } = useTranslation();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleNewFile = () => {
    dismissWelcome(dontShowAgain);
    onNewFile();
  };

  const handleOpenFile = () => {
    dismissWelcome(dontShowAgain);
    onOpenFile();
  };

  const handleOpenFolder = () => {
    dismissWelcome(dontShowAgain);
    onOpenFolder();
  };

  return (
    <div className="welcome-screen">
      <div className="welcome-card">
        <h1 className="welcome-title">{t("welcome.title")}</h1>
        <p className="welcome-tagline">
          {t("welcome.tagline")}
        </p>

        <div className="welcome-actions">
          <button className="welcome-btn welcome-btn-primary" onClick={handleOpenFolder}>
            {t("welcome.openFolder")}
          </button>
          <button className="welcome-btn welcome-btn-secondary" onClick={handleOpenFile}>
            {t("welcome.openFile")}
          </button>
          <button className="welcome-btn welcome-btn-secondary" onClick={handleNewFile}>
            {t("welcome.newFile")}
          </button>
        </div>

        <div className="welcome-tips">
          <p className="welcome-tips-title">{t("welcome.quickStart")}</p>
          <ul className="welcome-tips-list">
            <li>
              <kbd>⌘</kbd> + <kbd>P</kbd> {t("welcome.tip.commandPalette")}
            </li>
            <li>
              <kbd>/</kbd> {t("welcome.tip.slashCommand")}
            </li>
            <li>
              <kbd>⌘</kbd> + <kbd>/</kbd> {t("welcome.tip.sourceMode")}
            </li>
          </ul>
        </div>

        <label className="welcome-footer">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          <span>{t("welcome.dontShowAgain")}</span>
        </label>
      </div>
    </div>
  );
}
