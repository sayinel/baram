import type {
  PluginCapability,
  PluginStatus,
  RegistryEntry,
} from "../../plugins/types";

import { TriangleAlert } from "lucide-react";

// §69 Plugin Card — Compact card for marketplace listing
import { useTranslation } from "../../i18n/useTranslation";
import { PluginCapabilityBadge } from "./PluginCapabilityBadge";

interface PluginCardProps {
  entry: RegistryEntry;
  error?: string;
  /**
   * ‼️ OPTIONAL — absent means this card cannot be installed from, and no button is drawn.
   * The Updates tab passed a no-op to satisfy a required prop; that is the dead callback
   * this work removes rather than a way to fill the slot.
   */
  onInstall?: () => void;
  onSelect: () => void;
  onUninstall: () => void;
  onUpdate: () => void;
  revoked?: boolean;
  status: PluginStatus;
  updateAvailable?: string;
}

export function PluginCard({
  entry,
  error,
  status,
  updateAvailable,
  onInstall,
  onUninstall,
  onUpdate,
  onSelect,
  revoked,
}: PluginCardProps) {
  const { t } = useTranslation();
  return (
    <div className="plugin-card" onClick={onSelect}>
      <div className="plugin-card__row">
        <div className="plugin-card__main">
          <div className="plugin-card__head">
            {entry.icon && (
              <span className="plugin-card__icon">{entry.icon}</span>
            )}
            <span className="plugin-card__name">{entry.name}</span>
            <span className="plugin-card__version">v{entry.version}</span>
            {/* §69 — visible in the LIST, not only after opening the detail. A user
                scanning installed plugins should not have to click each one to find
                out which has been withdrawn. */}
            {revoked && (
              <span className="plugin-revoked-badge">
                {t("plugin.revoked.badge")}
              </span>
            )}
          </div>
          <p className="plugin-card__desc">{entry.description}</p>
          {error && (
            <div className="plugin-card__error">
              <TriangleAlert
                aria-label={t("plugin.marketplace.error")}
                className="icon-inline"
                role="img"
                size="1em"
              />{" "}
              {error}
            </div>
          )}
          <div className="plugin-card__meta-row">
            <span className="plugin-card__author">{entry.author}</span>
            {entry.downloads != null && (
              <span className="plugin-card__downloads">
                {t("plugin.card.downloads", {
                  count: entry.downloads.toLocaleString(),
                })}
              </span>
            )}
          </div>
          {entry.capabilities.length > 0 && (
            <div className="plugin-card__caps">
              {entry.capabilities.slice(0, 3).map((cap) => (
                <PluginCapabilityBadge
                  capability={cap as PluginCapability}
                  key={cap}
                />
              ))}
              {entry.capabilities.length > 3 && (
                <span className="plugin-card__more">
                  {t("plugin.card.moreCapabilities", {
                    count: String(entry.capabilities.length - 3),
                  })}
                </span>
              )}
            </div>
          )}
        </div>
        <div
          className="plugin-card__action"
          onClick={(e) => e.stopPropagation()}
        >
          {status === "installing" ? (
            <button className="plugin-card__installing-btn" disabled>
              {t("plugin.action.installing")}
            </button>
          ) : updateAvailable ? (
            <button className="plugin-card__update-btn" onClick={onUpdate}>
              {t("plugin.action.updateTo", { version: updateAvailable })}
            </button>
          ) : status === "enabled" || status === "disabled" ? (
            <button className="plugin-card__remove-btn" onClick={onUninstall}>
              {t("plugin.action.uninstall")}
            </button>
          ) : !onInstall ? null : ( // nothing wired this card to an install
            // §260 Phase 5 code review (M1) — a legacy entry (no `trust`) cannot be
            // installed: `validateManifest` rejects a trust-less manifest, so an enabled
            // button here only downloads and then fails. Both plugins in the live registry
            // are trust-less today, so this is the FIRST thing a user meets in Browse —
            // the detail view had the guard and the card did not.
            <button
              className="plugin-card__install-btn"
              disabled={!entry.trust}
              onClick={onInstall}
              title={entry.trust ? undefined : t("plugin.card.legacyBlocked")}
            >
              {t("plugin.action.install")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
