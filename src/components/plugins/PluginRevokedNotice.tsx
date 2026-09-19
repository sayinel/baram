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
import { securitySurfaceCss } from "../../utils/security-surface-css";
import { ShadowIsolated } from "../ui/ShadowIsolated";

export function PluginRevokedNotice({
  name,
  onRemove,
  revocation,
}: {
  /**
   * The plugin this notice is about. Required, not optional — see the button below:
   * an unnamed Remove is the defect this prop exists to fix, and a default would let a
   * new call site reintroduce it silently.
   */
  name: string;
  /**
   * ‼️ OPTIONAL, and its absence removes the button rather than the notice. Removal is
   * `actionsFor(source).canRemove`'s decision — a built-in has files this app does not
   * own — but the WARNING is not: a plugin the registry has withdrawn is worth saying
   * out loud whatever can be done about it. An earlier draft gated the whole notice and
   * would have silently withheld the warning from the one source that cannot act on it.
   */
  onRemove?: () => void;
  revocation: null | RevocationEntry;
}) {
  const { t } = useTranslation();
  // `unlisted` is bookkeeping — the author went quiet, the plugin merged elsewhere. The
  // spec forbids surfacing it, and most of a real withdrawal list is exactly this: a
  // notice shown for all of it would be worth ignoring by the time one matters.
  if (revocation === null || revocation.severity === "unlisted") return null;

  const stopped = revocation.severity === "malicious";
  return (
    // §359 — the LOWEST tier in `ShadowIsolated`'s header. Isolated but NOT portaled:
    // this notice means "the plugin in this row", and moved to `document.body` it would
    // lose the row it is about. The trade is written out there.
    <ShadowIsolated
      styles={securitySurfaceCss("revokedNotice")}
      variant="inline"
    >
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
            {/* §69 — the NAME goes in the accessible name, not in the visible text.
                Both call sites render this inside a list: two withdrawn plugins put two
                "Remove it" buttons on screen, identical to anyone navigating by control,
                with nothing to say which plugin each one removes.

                The visible text stays short because the surrounding markup already names
                the plugin beside it — `PluginRow` in its header, `PluginDetail` at its
                title — and because it reads as the end of the sentence above it ("Its
                files are left in place… Remove it"). Same trade `theme-gallery.tsx` made
                for `settings.appearance.deleteThemeNamed`, including putting the named
                form on `title` as well as `aria-label`.

                A separate key from `plugin.action.removeFor` on purpose: the two are
                identical in English but not in Korean, where the row's own button is
                삭제 and this one is 제거. Reusing that key would have changed this
                button's announced verb in ko as a side effect. */}
            {onRemove && (
              <button
                aria-label={t("plugin.revoked.removeNamed", { name })}
                className="plugin-revoked__remove"
                onClick={onRemove}
                title={t("plugin.revoked.removeNamed", { name })}
              >
                {t("plugin.revoked.remove")}
              </button>
            )}
          </>
        )}
      </div>
    </ShadowIsolated>
  );
}
