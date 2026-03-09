// About Baram modal
import { useEffect, useCallback } from "react";
import { useUIStore } from "../../stores/ui-store";
import baramLogo from "../../assets/baram-logo.png";
import { useTranslation } from "../../i18n/useTranslation";

export function AboutModal() {
  const { t } = useTranslation();
  const { aboutOpen, toggleAbout } = useUIStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleAbout();
    },
    [toggleAbout],
  );

  useEffect(() => {
    if (!aboutOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [aboutOpen, handleKeyDown]);

  if (!aboutOpen) return null;

  return (
    <div className="about-overlay" onClick={toggleAbout}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <img src={baramLogo} alt="Baram" className="about-logo" />
        <div className="about-version">
          {t("about.version").replace("{version}", "0.1.0")}
        </div>
        <div className="about-description">{t("about.description")}</div>
        <div className="about-details">
          <div className="about-row">
            <span className="about-label">{t("about.license")}</span>
            <span className="about-value">Editor Core MIT / App AGPL-3.0</span>
          </div>
          <div className="about-row">
            <span className="about-label">{t("about.stack")}</span>
            <span className="about-value">
              Tauri 2.0 + React + Tiptap + Rust
            </span>
          </div>
        </div>
        <div className="about-copyright">{t("about.copyright")}</div>
        <button className="about-close" onClick={toggleAbout}>
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
