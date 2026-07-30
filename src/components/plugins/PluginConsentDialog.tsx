import { useEffect, useState } from "react";

import type { PluginConsent } from "../../plugins/types";

import { useTranslation } from "../../i18n/useTranslation";
import { consentCovers } from "../../plugins/plugin-consent";
import { capabilityLabel } from "./capability-label";

interface PluginConsentDialogProps {
  /** What is being asked for now — a registry claim, never a downloaded manifest. */
  consent: PluginConsent;
  /**
   * What the user is actually doing, which is NOT derivable from `reason` (§260 Phase 5
   * code review, M2): `backfillConsent` deliberately leaves a legacy manifest without a
   * record, so updating one yields `reason: "first-install"` — and the dialog titled
   * itself "Install" over a button that updates. Only the caller knows.
   */
  intent: "install" | "update";
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** The recorded consent, when this is an update. Drives the "NEW" markers. */
  prior?: PluginConsent;
}

/**
 * §260 Phase 5 — the grant step the ADR carried as a residual: until now the install UI
 * *displayed* capabilities in a `window.confirm` and the loader passed
 * `manifest.capabilities` straight through, so nothing was ever granted, only shown.
 *
 * The acknowledgement checkbox exists for the trusted tier ALONE, and not as extra
 * ceremony: for a sandboxed plugin the capability list *is* the boundary, because every
 * brokered op is authorized against it in Rust. For a trusted plugin the same list is
 * merely a description — it runs in the app's own realm and holds everything regardless.
 * A user who reads only the list would draw exactly the wrong conclusion, so the danger
 * copy says so and the checkbox makes them pass through it.
 *
 * All copy comes from i18n. It used to be half-and-half — the title, buttons and danger
 * text hardcoded in English while the capability lines came from `CAPABILITY_DESCRIPTIONS`,
 * which is written in Korean — so the last screen before running third-party code showed
 * two languages at once in either locale setting.
 */
export function PluginConsentDialog({
  consent,
  intent,
  name,
  onCancel,
  onConfirm,
  prior,
}: PluginConsentDialogProps) {
  const { t } = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);
  const trusted = consent.trust === "trusted";
  const installing = intent === "install";

  // Escape cancels. A dialog that vanished without an answer must never resolve as
  // consent — the caller is awaiting a decision, and "dismissed" is a refusal.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="plugin-consent-overlay">
      <div aria-modal="true" className="plugin-consent" role="dialog">
        {/*
         * Only the BODY scrolls. When the whole dialog was the scroll container, the
         * acknowledgement checkbox and both buttons sat inside it: seven capabilities pushed
         * the buttons below the fold at 1280x800, thirteen hid 288px of the dialog, and
         * macOS overlay scrollbars gave no hint that anything was there. A consent dialog
         * whose Cancel button cannot be seen is the worst possible version of this screen.
         * Same header/body/actions split as `.migration-dialog-body`.
         */}
        <div className="plugin-consent__body">
          <h3 className="plugin-consent__title">
            {t(
              installing
                ? "plugin.consent.title.install"
                : "plugin.consent.title.update",
              { name },
            )}
          </h3>

          {trusted && (
            <div className="plugin-consent__danger" role="alert">
              <strong className="plugin-consent__danger-title">
                {t("plugin.consent.fullTrust.title")}
              </strong>
              {t("plugin.consent.fullTrust.body")}
            </div>
          )}

          <p className="plugin-consent__lead">
            {t(
              consent.capabilities.length > 0
                ? "plugin.consent.requests"
                : "plugin.consent.requestsNone",
            )}
          </p>

          {consent.capabilities.length > 0 && (
            <ul className="plugin-consent__caps">
              {consent.capabilities.map((cap) => (
                <li className="plugin-consent__cap" key={cap}>
                  <span className="plugin-consent__cap-text">
                    {capabilityLabel(cap, t)}
                  </span>
                  {prior && !consentCovers(prior, cap) && (
                    <span className="plugin-consent__new">
                      {t("plugin.consent.new")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Outside the scroll container on purpose — the gate and the decision must always
            be on screen, however many capabilities the list holds. */}
        {trusted && (
          <label className="plugin-consent__ack">
            <input
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              type="checkbox"
            />
            <span>{t("plugin.consent.ack")}</span>
          </label>
        )}

        <div className="plugin-consent__actions">
          <button
            className="btn-unstyled plugin-consent__cancel"
            onClick={onCancel}
            type="button"
          >
            {t("plugin.consent.cancel")}
          </button>
          <button
            className="plugin-consent__confirm"
            disabled={trusted && !acknowledged}
            onClick={onConfirm}
            type="button"
          >
            {t(
              installing
                ? "plugin.consent.confirm.install"
                : "plugin.consent.confirm.update",
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
