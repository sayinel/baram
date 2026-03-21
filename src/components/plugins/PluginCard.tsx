import type {
  PluginCapability,
  PluginStatus,
  RegistryEntry,
} from "../../plugins/types";

// §69 Plugin Card — Compact card for marketplace listing
import { PluginCapabilityBadge } from "./PluginCapabilityBadge";

interface PluginCardProps {
  entry: RegistryEntry;
  onInstall: () => void;
  onSelect: () => void;
  onUninstall: () => void;
  onUpdate: () => void;
  status: PluginStatus;
  updateAvailable?: string;
}

export function PluginCard({
  entry,
  status,
  updateAvailable,
  onInstall,
  onUninstall,
  onUpdate,
  onSelect,
}: PluginCardProps) {
  return (
    <div
      className="plugin-card"
      onClick={onSelect}
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "var(--color-hover, #f3f4f6)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.backgroundColor = "transparent")
      }
      style={{
        padding: "12px 16px",
        borderBottom: "1px solid var(--color-border-default, #e5e7eb)",
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
                color: "var(--color-text-primary, #111)",
              }}
            >
              {entry.name}
            </span>
            <span
              style={{
                fontSize: "12px",
                color: "var(--color-text-muted, #6b7280)",
              }}
            >
              v{entry.version}
            </span>
          </div>
          <p
            style={{
              margin: "0 0 8px",
              fontSize: "13px",
              color: "var(--color-text-secondary, #4b5563)",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.description}
          </p>
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
                color: "var(--color-text-muted, #6b7280)",
              }}
            >
              {entry.author}
            </span>
            {entry.downloads != null && (
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--color-text-muted, #9ca3af)",
                }}
              >
                {entry.downloads.toLocaleString()} downloads
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
                    color: "var(--color-text-muted, #9ca3af)",
                    alignSelf: "center",
                  }}
                >
                  +{entry.capabilities.length - 3} more
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
                backgroundColor: "var(--color-bg-subtle, #f3f4f6)",
                color: "var(--color-text-disabled, #9ca3af)",
                border: "1px solid var(--color-border-default, #e5e7eb)",
                cursor: "not-allowed",
              }}
            >
              Installing…
            </button>
          ) : updateAvailable ? (
            <button
              onClick={onUpdate}
              style={{
                padding: "6px 16px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 500,
                backgroundColor: "#f59e0b",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              Update to v{updateAvailable}
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
                color: "var(--color-status-danger, #dc2626)",
                border: "1px solid var(--color-status-danger, #dc2626)",
                cursor: "pointer",
              }}
            >
              Uninstall
            </button>
          ) : (
            <button
              onClick={onInstall}
              style={{
                padding: "6px 16px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 500,
                backgroundColor: "var(--color-accent-default, #3b82f6)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
