// §69 — the one withdrawal notice, rendered wherever a user can meet a revoked plugin.
//
// Extracted rather than duplicated because the two surfaces it serves are reached in
// DIFFERENT situations and the second one is the likely one. Pulling a malicious plugin
// from the registry index is the normal response, and once it is pulled the plugin is
// absent from Browse and from Updates — both iterate the registry — so `PluginDetail`
// is unreachable for it. The Installed tab becomes the only place the user can see
// anything at all, and it was the one place with no notice.
//
// A second copy of this JSX in that tab would have drifted from this one the first time
// either changed, which is the failure mode this file exists to prevent.

import type { RevocationEntry } from "../../plugins/revocation";

import { useTranslation } from "../../i18n/useTranslation";
import { revocationReason } from "../../plugins/revocation";

export function PluginRevokedNotice({
  onRemove,
  revocation,
}: {
  onRemove: () => void;
  revocation: null | RevocationEntry;
}) {
  const { t } = useTranslation();
  // `unlisted` is bookkeeping — the author went quiet, the plugin merged elsewhere. The
  // spec forbids surfacing it, and most of a real withdrawal list is exactly this: a
  // notice shown for all of it would be worth ignoring by the time one matters.
  if (revocation === null || revocation.severity === "unlisted") return null;

  const stopped = revocation.severity === "malicious";
  return (
    <div
      className={
        stopped ? "plugin-revoked" : "plugin-revoked plugin-revoked--warn"
      }
    >
      <span className="plugin-revoked__title">
        {stopped
          ? t("plugin.revoked.blockedLoad")
          : t("plugin.revoked.vulnerable")}
      </span>
      <span className="plugin-revoked__reason">
        {t("plugin.revoked.reason")}: {revocationReason(revocation, t)}
      </span>
      {stopped && (
        <>
          {/* Says the files were kept. Without it "not running" reads as "gone", and
              the whole reason we refuse the load instead of deleting is that the user
              stays in control of that choice. */}
          <span className="plugin-revoked__note">
            {t("plugin.revoked.keepFiles")}
          </span>
          <button className="plugin-revoked__remove" onClick={onRemove}>
            {t("plugin.revoked.remove")}
          </button>
        </>
      )}
    </div>
  );
}
