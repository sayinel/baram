import { useEffect, useState } from "react";

import type { PluginConsent } from "../../plugins/types";

import { consentCovers } from "../../plugins/plugin-consent";
import { CAPABILITY_DESCRIPTIONS } from "../../plugins/types";

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
 */
export function PluginConsentDialog({
  consent,
  intent,
  name,
  onCancel,
  onConfirm,
  prior,
}: PluginConsentDialogProps) {
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
        <h3 className="plugin-consent__title">
          {installing ? "Install" : "Update"} “{name}”?
        </h3>

        {trusted && (
          <div className="plugin-consent__danger" role="alert">
            <strong>This plugin asks for full trust.</strong> It runs inside
            Baram itself with no sandbox: it can read and write any file your
            account can reach, contact any network host, and use every
            credential the app holds. The capability list below describes what
            it intends to do — it does not limit it.
          </div>
        )}

        <p className="plugin-consent__lead">
          {consent.capabilities.length > 0
            ? "It requests:"
            : "It requests no capabilities."}
        </p>

        <ul className="plugin-consent__caps">
          {consent.capabilities.map((cap) => (
            <li key={cap}>
              {CAPABILITY_DESCRIPTIONS[cap] ?? cap}
              {prior && !consentCovers(prior, cap) && (
                <span className="plugin-consent__new"> NEW</span>
              )}
            </li>
          ))}
        </ul>

        {trusted && (
          <label className="plugin-consent__ack">
            <input
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              type="checkbox"
            />
            I understand this plugin is not sandboxed.
          </label>
        )}

        <div className="plugin-consent__actions">
          <button
            className="btn-unstyled plugin-consent__cancel"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="plugin-consent__confirm"
            disabled={trusted && !acknowledged}
            onClick={onConfirm}
            type="button"
          >
            {installing ? "Install" : "Update and install"}
          </button>
        </div>
      </div>
    </div>
  );
}
