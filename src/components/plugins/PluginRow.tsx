// §69 — 한 행. 액션 세트는 `actionsFor(source)`에서만 나온다.
import type { PluginRow } from "../../plugins/plugin-sources";

import { useTranslation } from "../../i18n/useTranslation";
import { actionsFor } from "../../plugins/plugin-sources";
import { PluginCapabilityBadge } from "./PluginCapabilityBadge";
import { PluginRevokedNotice } from "./PluginRevokedNotice";

interface PluginRowViewProps {
  onDetails: () => void;
  /**
   * ‼️ OPTIONAL for the same reason as `onSettings`. PR1 keeps the dev section in
   * `PluginDeveloperSection`, so the marketplace shell renders no dev row and has no reload
   * to wire — and a required prop would force it to pass a callback nothing can call, which
   * is the dead-callback defect this work exists to remove (the Updates tab's
   * `onInstall={() => {}}`). `actionsFor` still decides the action SET; this answers the
   * separate question of whether that action is wired up.
   */
  onReload?: () => void;
  onRemove: () => void;
  /**
   * ‼️ OPTIONAL, 사용자 결정 2026-08-06. PR1에는 설정 페이지가 아직 없으므로 아무도 이것을
   * 넘기지 않고, ⚙는 그려지지 않는다. 앞선 초안은 `hasSettings={() => false}`와 no-op
   * `onSettings`를 넘기게 했는데, 그것은 이 작업이 지적하려는 결함 그 자체다 — Updates 탭의
   * `onInstall={() => {}}`. 부재를 no-op으로 위장하지 않고 부재로 표현한다.
   */
  onSettings?: () => void;
  onToggle: () => void;
  onUpdate: () => void;
  row: PluginRow;
}

export function PluginRowView({
  onDetails,
  onReload,
  onRemove,
  onSettings,
  onToggle,
  onUpdate,
  row,
}: PluginRowViewProps) {
  const { t } = useTranslation();
  const can = actionsFor(row.source);
  const { manifest } = row;
  const named = { name: manifest.name };

  return (
    <div className="plugin-row">
      <div className="plugin-row__main">
        <div className="plugin-row__head">
          {manifest.icon && (
            <span className="plugin-row__icon">{manifest.icon}</span>
          )}
          <span className="plugin-row__name">{manifest.name}</span>
          <span className="plugin-row__version">v{manifest.version}</span>
          {row.source === "builtin" && (
            <span className="plugin-row__badge">
              {t("plugin.builtin.badge")}
            </span>
          )}
        </div>
        <p className="plugin-row__desc text-truncate">{manifest.description}</p>
        {/* The error TEXT, not just a badge — this doctrine moved here with the Installed
            tab's markup. It used to show only an "Error" chip, and this is the one surface
            where a plugin with no registry entry appears at all: Browse, Updates and the
            detail view every one of them iterate the REGISTRY. So for a plugin whose entry
            has been withdrawn, this was the only place the user could see it and the only
            place that explained nothing. Pinned by `installed-error-text.test.tsx`. */}
        {row.error && <p className="plugin-row__error">⚠ {row.error}</p>}
        {manifest.capabilities.length > 0 && (
          <div className="plugin-row__caps">
            {manifest.capabilities.slice(0, 3).map((c) => (
              <PluginCapabilityBadge capability={c} key={c} />
            ))}
          </div>
        )}
        {/* ‼️ THROUGH `can`, like every other action on this row. The shell hands every
            row an `onRemove` — built-ins included — and this passed it straight on, so a
            row that cannot remove anything would still have offered the button. It never
            fired only because `buildPluginRows` sets no `revocation` on a built-in and
            the notice returns null: two incidental facts holding up a rule that has one
            authority. */}
        <PluginRevokedNotice
          onRemove={can.canRemove ? onRemove : undefined}
          revocation={row.revocation ?? null}
        />
      </div>
      <div className="plugin-row__actions">
        <button
          aria-label={t("plugin.marketplace.viewDetails", named)}
          className="plugin-row__btn"
          onClick={onDetails}
          type="button"
        >
          {t("plugin.action.details")}
        </button>
        {onSettings && (
          <button
            aria-label={t("plugin.action.settingsFor", named)}
            className="plugin-row__btn"
            onClick={onSettings}
            type="button"
          >
            {t("plugin.action.settings")}
          </button>
        )}
        {can.canReload && onReload && (
          <button
            aria-label={t("plugin.action.reloadFor", named)}
            className="plugin-row__btn"
            onClick={onReload}
            type="button"
          >
            {t("plugin.action.reload")}
          </button>
        )}
        {can.canUpdate && row.updateVersion && (
          <button
            aria-label={t("plugin.action.updateFor", named)}
            className="plugin-row__btn plugin-row__btn--warn"
            onClick={onUpdate}
            type="button"
          >
            {t("plugin.action.updateTo", { version: row.updateVersion })}
          </button>
        )}
        {can.canToggle && (
          <label className="plugin-row__toggle">
            {/* ‼️ NAMED like every other control here. Without this the checkbox took its
                accessible name from the wrapping label's "On"/"Off" text, so a section
                with two enabled built-ins offered two checkboxes both called "On" and
                nothing said which plugin either one governed. The visible text stays —
                it reports the state, and this reports the object. */}
            <input
              aria-label={t("plugin.action.toggleFor", named)}
              checked={row.enabled}
              onChange={onToggle}
              type="checkbox"
            />
            <span>
              {row.enabled ? t("plugin.action.on") : t("plugin.action.off")}
            </span>
          </label>
        )}
        {can.canRemove && (
          <button
            aria-label={t("plugin.action.removeFor", named)}
            className="plugin-row__btn plugin-row__btn--danger"
            onClick={onRemove}
            type="button"
          >
            {t("plugin.action.remove")}
          </button>
        )}
      </div>
    </div>
  );
}
