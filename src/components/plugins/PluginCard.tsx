import type {
  PluginCapability,
  PluginStatus,
  RegistryEntry,
} from "../../plugins/types";

// §69 Plugin Card — Compact card for marketplace listing
import { useTranslation } from "../../i18n/useTranslation";
import { PluginCapabilityBadge } from "./PluginCapabilityBadge";

interface PluginCardProps {
  entry: RegistryEntry;
  error?: string;
  onInstall: () => void;
  onSelect: () => void;
  onUninstall: () => void;
  onUpdate: () => void;
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
}: PluginCardProps) {
  const { t } = useTranslation();
  return (
    <div
      className="plugin-card"
      onClick={onSelect}
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "var(--color-bg-subtle)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.backgroundColor = "transparent")
      }
      style={{
        padding: "12px 16px",
        borderBottom: "1px solid var(--color-border-default)",
        cursor: "pointer",
        transition: "background-color 0.15s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "4px",
            }}
          >
            {entry.icon && (
              <span style={{ fontSize: "20px" }}>{entry.icon}</span>
            )}
            <span
              style={{
                fontWeight: 600,
                fontSize: "14px",
                color: "var(--color-text-primary)",
              }}
            >
              {entry.name}
            </span>
            <span
              style={{
                fontSize: "12px",
                color: "var(--color-text-muted)",
              }}
            >
              v{entry.version}
            </span>
          </div>
          <p
            style={{
              margin: "0 0 8px",
              fontSize: "13px",
              color: "var(--color-text-secondary)",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.description}
          </p>
          {error && (
            <div
              style={{
                padding: "8px 12px",
                margin: "0 0 8px",
                borderRadius: "6px",
                backgroundColor: "var(--color-status-error-bg)",
                color: "var(--color-status-danger)",
                fontSize: "12px",
                border: "1px solid var(--color-status-error-border)",
                // Checksums are unbroken 64-char tokens — without this they
                // overflow the banner horizontally.
                overflowWrap: "anywhere",
              }}
            >
              ⚠ {error}
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "12px",
                color: "var(--color-text-muted)",
              }}
            >
              {entry.author}
            </span>
            {entry.downloads != null && (
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--color-text-muted)",
                }}
              >
                {t("plugin.card.downloads", {
                  count: entry.downloads.toLocaleString(),
                })}
              </span>
            )}
          </div>
          {entry.capabilities.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: "4px",
                marginTop: "6px",
                flexWrap: "wrap",
              }}
            >
              {entry.capabilities.slice(0, 3).map((cap) => (
                <PluginCapabilityBadge
                  capability={cap as PluginCapability}
                  key={cap}
                />
              ))}
              {entry.capabilities.length > 3 && (
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--color-text-muted)",
                    alignSelf: "center",
                  }}
                >
                  {t("plugin.card.moreCapabilities", {
                    count: String(entry.capabilities.length - 3),
                  })}
                </span>
              )}
            </div>
          )}
        </div>
        <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          {status === "installing" ? (
            <button
              disabled
              style={{
                padding: "6px 16px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 500,
                backgroundColor: "var(--color-bg-subtle)",
                color: "var(--color-text-disabled)",
                border: "1px solid var(--color-border-default)",
                cursor: "not-allowed",
              }}
            >
              {t("plugin.action.installing")}
            </button>
          ) : updateAvailable ? (
            <button
              onClick={onUpdate}
              style={{
                padding: "6px 16px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 500,
                backgroundColor: "var(--color-status-warning)",
                color: "var(--color-status-warning-on-solid)",
                border: "none",
                cursor: "pointer",
              }}
            >
              {t("plugin.action.updateTo", { version: updateAvailable })}
            </button>
          ) : status === "enabled" || status === "disabled" ? (
            <button
              onClick={onUninstall}
              style={{
                padding: "6px 16px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 500,
                backgroundColor: "transparent",
                color: "var(--color-status-danger)",
                border: "1px solid var(--color-status-danger)",
                cursor: "pointer",
              }}
            >
              {t("plugin.action.uninstall")}
            </button>
          ) : (
            // §260 Phase 5 code review (M1) — a legacy entry (no `trust`) cannot be
            // installed: `validateManifest` rejects a trust-less manifest, so an enabled
            // button here only downloads and then fails. Both plugins in the live registry
            // are trust-less today, so this is the FIRST thing a user meets in Browse —
            // the detail view had the guard and the card did not.
            <button
              disabled={!entry.trust}
              onClick={onInstall}
              style={{
                padding: "6px 16px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 500,
                backgroundColor: "var(--color-accent-solid)",
                color: "var(--color-accent-on-solid)",
                border: "none",
                cursor: entry.trust ? "pointer" : "not-allowed",
                opacity: entry.trust ? 1 : 0.5,
              }}
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
