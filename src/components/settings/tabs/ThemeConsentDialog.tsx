// §361 — split out of ThemeBrowser.tsx in review round 2, F3's shadow-isolation fix.
//
// One file per security surface, not one function inside a bigger screen: the effect scan
// (`src/utils/security-surfaces.ts`, `src/__tests__/security-surfaces.test.ts`) and the
// class-list guard (`src/utils/security-surface-css.ts`) both key on FILE SOURCE TEXT —
// `PluginConsentDialog.tsx`/`PluginRevokedNotice.tsx`/`ApprovedRootsSection.tsx` are each
// their own file for the same reason. Kept inline in `ThemeBrowser.tsx` (the browse
// screen's OTHER classes — `theme-browser`, `theme-browser-card`, …), the class-list test
// would have required every one of those unrelated classes to be added to
// `SECURITY_SURFACE_CLASSES.themeConsent` too, which is not what "this dialog's shadow
// root" means.
import { useEffect } from "react";

import { useTranslation } from "../../../i18n/useTranslation";
import { securitySurfaceCss } from "../../../utils/security-surface-css";
import { ShadowIsolated } from "../../ui/ShadowIsolated";
import { themeConsentSentences } from "./use-theme-actions";

/**
 * §9.3's three fixed sentences — a theme has no `capabilities`, so there is nothing to list
 * per-capability the way `PluginConsentDialog` does.
 *
 * ‼️ Shadow-isolated, as of review round 2 (F3) — fix round 1 tried to close this with CSS
 * alone (declaring `display`/`opacity`/`visibility` explicit and unlayered on every node),
 * and the re-review found the enumeration incomplete on three of eight nodes
 * (`.theme-consent-list li` — the sentences THEMSELVES — and both buttons carried no
 * `display`). The deeper finding was structural, not just those three gaps: a
 * property-by-property allowlist has to be complete on two axes, every element × every
 * property a hostile theme could use, and the second axis is open-ended (`transform`,
 * `clip-path`, `height`+`overflow`, `position`+offsets, `font-size`, colour-matched-to-
 * background, …) — not closable by enumeration, which is why spec §8.2 prescribes shadow
 * DOM for a consent gate rather than CSS hardening. `styles/settings/theme.css`'s
 * `.theme-consent-overlay` comment carries the full history and keeps the per-node
 * properties as belt-and-braces (same framing `security-surface-host.css` uses for its own
 * `@layer`-vs-`!important` redundancy) — this comment states only what changed here.
 *
 * `variant="overlay"`, same tier as `PluginConsentDialog`: hidden, the user installs a
 * theme without seeing what it changes, runs, or connects to. Portaled to `document.body`
 * via the shadow host, so this dialog's stacking position does not depend on an ancestor
 * the theme could hide or trap under (§323's shape).
 *
 * ‼️ The third sentence ("makes no network connection") is true only because 0089 made it
 * STRUCTURALLY true — stored CSS carries no URL other than `data:` (`inlineThemeAssets`
 * turns every reference into one before anything is stored). If any 0089 layer is ever
 * loosened, this sentence becomes false and nothing here would notice — it is asserted as
 * copy, not re-verified per install.
 */
export function ThemeConsentDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  // Escape cancels — a dialog that vanished without an answer must never resolve as
  // consent (same guard, same reason, as PluginConsentDialog's).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <ShadowIsolated
      styles={securitySurfaceCss("themeConsent")}
      variant="overlay"
    >
      <div className="theme-consent-overlay">
        <div aria-modal="true" className="theme-consent" role="dialog">
          <h3 className="theme-consent-title">
            {t("settings.appearance.installConsent.title", { name })}
          </h3>
          <ul className="theme-consent-list">
            {themeConsentSentences(t).map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
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
    </ShadowIsolated>
  );
}
