// §69 — 한 행. 액션 세트는 `actionsFor(source)`에서만 나온다.
import type { PluginRow } from "../../plugins/plugin-sources";

import { useTranslation } from "../../i18n/useTranslation";
import { actionsFor } from "../../plugins/plugin-sources";
import { PluginCapabilityBadge } from "./PluginCapabilityBadge";
import { PluginRevokedNotice } from "./PluginRevokedNotice";

interface PluginRowViewProps {
  onDetails: () => void;
  onReload: () => void;
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
        {row.error && <p className="plugin-row__error">⚠ {row.error}</p>}
        {manifest.capabilities.length > 0 && (
          <div className="plugin-row__caps">
            {manifest.capabilities.slice(0, 3).map((c) => (
              <PluginCapabilityBadge capability={c} key={c} />
            ))}
          </div>
        )}
        <PluginRevokedNotice
          onRemove={onRemove}
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
        {can.canReload && (
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
            <input checked={row.enabled} onChange={onToggle} type="checkbox" />
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
