// About Baram modal
import { useCallback, useEffect, useState } from "react";

import { getVersion } from "@tauri-apps/api/app";

import baramSymbol from "../../assets/baram-symbol.png";
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
        <img alt="" className="about-symbol" src={baramSymbol} />
        <div className="about-wordmark">Baram</div>
        <div className="about-tagline">Like the wind, light and free</div>
        <div className="about-version">
          {t("about.version").replace("{version}", version)}
        </div>
        <div className="about-description">{t("about.description")}</div>
        <div className="about-details">
          <div className="about-row">
            <span className="about-label">{t("about.license")}</span>
            <span className="about-value">Apache License 2.0</span>
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
