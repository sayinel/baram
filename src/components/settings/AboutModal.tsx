// About Baram modal
import { useCallback, useEffect, useState } from "react";

import { getVersion } from "@tauri-apps/api/app";

import baramLogo from "../../assets/baram-logo.png";
import { useTranslation } from "../../i18n/useTranslation";
import { useUIStore } from "../../stores/ui/ui";

export function AboutModal() {
  const { t } = useTranslation();
  const { aboutOpen, toggleAbout } = useUIStore();
  const [version, setVersion] = useState("");

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleAbout();
    },
    [toggleAbout],
  );

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        /* non-Tauri context (e.g. tests) — leave version blank */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!aboutOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [aboutOpen, handleKeyDown]);

  if (!aboutOpen) return null;

  return (
    <div className="about-overlay" onClick={toggleAbout}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <img alt="Baram" className="about-logo" src={baramLogo} />
        <div className="about-version">
          {t("about.version").replace("{version}", version)}
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
