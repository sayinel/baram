import { useEffect, useState } from "react";

import type { PluginConsent } from "../../plugins/types";

import { TriangleAlert } from "lucide-react";

import { useTranslation } from "../../i18n/useTranslation";
import { consentCovers } from "../../plugins/plugin-consent";
import { securitySurfaceCss } from "../../utils/security-surface-css";
import { ShadowIsolated } from "../ui/ShadowIsolated";
import { capabilityLabel } from "./capability-label";

interface PluginConsentDialogProps {
  /** What is being asked for now — a registry claim, never a downloaded manifest. */
  consent: PluginConsent;
  /**
   * What the user is actually doing, which is NOT derivable from `reason` (§260 Phase 5
   * code review, M2): `backfillConsent` deliberately leaves a legacy manifest without a
   * record, so updating one yields `reason: "first-install"` — and the dialog titled
   * itself "Install" over a button that updates. Only the caller knows.
   *
   * `"load"` (§379 F2) is a folder loaded in developer mode — nothing is installed, so
   * neither of the other two titles is true of it.
   */
  intent: "install" | "load" | "update";
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** The recorded consent, when this is an update. Drives the "NEW" markers. */
  prior?: PluginConsent;
}

/** The title and confirm-button keys per intent — static keys, so the catalogue checks see them. */
const TITLE_KEY = {
  install: "plugin.consent.title.install",
  load: "plugin.consent.title.load",
  update: "plugin.consent.title.update",
} as const;

const CONFIRM_KEY = {
  install: "plugin.consent.confirm.install",
  load: "plugin.consent.confirm.load",
  update: "plugin.consent.confirm.update",
} as const;

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
    // §359 — the HIGHEST tier in `ShadowIsolated`'s header: hidden, this screen
    // grants capabilities without being read, so its host is portaled to
    // `document.body` rather than merely wrapped.
    <ShadowIsolated
      styles={securitySurfaceCss("consentDialog")}
      variant="overlay"
    >
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
              {t(TITLE_KEY[intent], { name })}
            </h3>

            {trusted && (
              <div className="plugin-consent__danger" role="alert">
                <strong className="plugin-consent__danger-title">
                  {/* 제목은 baseline 정렬 flex 다. svg 를 바로 flex 항목으로 두면 기준선이
                      없어 아래 가장자리가 기준선에 앉아 떠 보이므로, 인라인 svg 를 span 에
                      담아 그 span 이 첫 줄의 기준선을 갖게 한다. */}
                  <span className="plugin-consent__danger-icon">
                    <TriangleAlert className="icon-inline" size="1em" />
                  </span>
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
              {t(CONFIRM_KEY[intent])}
            </button>
          </div>
        </div>
      </div>
    </ShadowIsolated>
  );
}
