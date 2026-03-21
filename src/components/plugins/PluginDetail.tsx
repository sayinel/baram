import type {
  PluginCapability,
  PluginStatus,
  RegistryEntry,
} from "../../plugins/types";

// §69 Plugin Detail Panel — Full info view for a selected plugin
import { PluginCapabilityBadge } from "./PluginCapabilityBadge";

interface PluginDetailProps {
  entry: RegistryEntry;
  error?: string;
  onBack: () => void;
  onInstall: () => void;
  onToggleEnabled: () => void;
  onUninstall: () => void;
  onUpdate: () => void;
  readme?: null | string;
  status: PluginStatus;
  updateAvailable?: string;
}

export function PluginDetail({
  entry,
  status,
  updateAvailable,
  error,
  onInstall,
  onUninstall,
  onUpdate,
  onToggleEnabled,
  readme,
  onBack,
}: PluginDetailProps) {
  return (
    <div
      className="plugin-detail"
      style={{ padding: "16px", overflowY: "auto", height: "100%" }}
    >
      {/* Back button */}
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          marginBottom: "16px",
          padding: "4px 8px",
          borderRadius: "4px",
          fontSize: "13px",
          backgroundColor: "transparent",
          color: "var(--color-text-muted)",
          border: "none",
          cursor: "pointer",
        }}
      >
        &larr; Back
      </button>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        {entry.icon && <span style={{ fontSize: "32px" }}>{entry.icon}</span>}
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: "20px",
              fontWeight: 700,
              color: "var(--color-text-primary)",
            }}
          >
            {entry.name}
          </h2>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "4px",
            }}
          >
            <span
              style={{
                fontSize: "13px",
                color: "var(--color-text-muted)",
              }}
            >
              {entry.author}
            </span>
            <span
              style={{
                fontSize: "13px",
                color: "var(--color-text-muted)",
              }}
            >
              v{entry.version}
            </span>
            <span
              style={{
                fontSize: "12px",
                color: "var(--color-text-muted)",
              }}
            >
              {entry.license}
            </span>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: "12px",
            borderRadius: "6px",
            backgroundColor: "var(--color-status-error-bg)",
            color: "var(--color-status-danger)",
            fontSize: "13px",
            border: "1px solid var(--color-status-error-border)",
          }}
        >
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        {status === "installing" ? (
          <button
            disabled
            style={{
              padding: "8px 20px",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 500,
              backgroundColor: "var(--color-bg-subtle)",
              color: "var(--color-text-disabled)",
              border: "1px solid var(--color-border-default)",
            }}
          >
            Installing…
          </button>
        ) : status === "enabled" || status === "disabled" ? (
          <>
            <button
              onClick={onToggleEnabled}
              style={{
                padding: "8px 20px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 500,
                backgroundColor:
                  status === "enabled"
                    ? "var(--color-accent-default)"
                    : "var(--color-bg-subtle)",
                color:
                  status === "enabled" ? "#fff" : "var(--color-text-primary)",
                border:
                  status === "enabled"
                    ? "none"
                    : "1px solid var(--color-border-default)",
                cursor: "pointer",
              }}
            >
              {status === "enabled" ? "Enabled" : "Disabled"}
            </button>
            {updateAvailable && (
              <button
                onClick={onUpdate}
                style={{
                  padding: "8px 20px",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 500,
                  backgroundColor: "#f59e0b",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Update to v{updateAvailable}
              </button>
            )}
            <button
              onClick={onUninstall}
              style={{
                padding: "8px 20px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 500,
                backgroundColor: "transparent",
                color: "var(--color-status-danger)",
                border: "1px solid var(--color-status-danger)",
                cursor: "pointer",
              }}
            >
              Uninstall
            </button>
          </>
        ) : (
          <button
            onClick={onInstall}
            style={{
              padding: "8px 20px",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 500,
              backgroundColor: "var(--color-accent-default)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            Install
          </button>
        )}
      </div>

      {/* Description */}
      <div style={{ marginBottom: "20px" }}>
        <h3
          style={{
            fontSize: "14px",
            fontWeight: 600,
            marginBottom: "8px",
            color: "var(--color-text-primary)",
          }}
        >
          Description
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: "14px",
            lineHeight: 1.6,
            color: "var(--color-text-secondary)",
          }}
        >
          {entry.description}
        </p>
      </div>

      {/* README */}
      {readme && (
        <div style={{ marginBottom: "20px" }}>
          <h3
            style={{
              fontSize: "14px",
              fontWeight: 600,
              marginBottom: "8px",
              color: "var(--color-text-primary)",
            }}
          >
            README
          </h3>
          <pre
            style={{
              margin: 0,
              padding: "12px",
              borderRadius: "6px",
              fontSize: "13px",
              lineHeight: 1.6,
              backgroundColor: "var(--color-bg-subtle)",
              color: "var(--color-text-secondary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflowX: "auto",
              border: "1px solid var(--color-border-default)",
              maxHeight: "300px",
              overflowY: "auto",
            }}
          >
            {readme}
          </pre>
        </div>
      )}

      {/* Capabilities */}
      <div style={{ marginBottom: "20px" }}>
        <h3
          style={{
            fontSize: "14px",
            fontWeight: 600,
            marginBottom: "8px",
            color: "var(--color-text-primary)",
          }}
        >
          Capabilities
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {entry.capabilities.map((cap) => (
            <PluginCapabilityBadge
              capability={cap as PluginCapability}
              key={cap}
              showDescription
            />
          ))}
          {entry.capabilities.length === 0 && (
            <span
              style={{
                fontSize: "13px",
                color: "var(--color-text-muted)",
              }}
            >
              No special permissions required
            </span>
          )}
        </div>
      </div>

      {/* Links */}
      <div style={{ marginBottom: "20px" }}>
        <h3
          style={{
            fontSize: "14px",
            fontWeight: 600,
            marginBottom: "8px",
            color: "var(--color-text-primary)",
          }}
        >
          Links
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {entry.repository && (
            <a
              href={entry.repository}
              rel="noopener noreferrer"
              style={{
                fontSize: "13px",
                color: "var(--color-accent-default)",
              }}
              target="_blank"
            >
              Repository
            </a>
          )}
          {entry.homepage && (
            <a
              href={entry.homepage}
              rel="noopener noreferrer"
              style={{
                fontSize: "13px",
                color: "var(--color-accent-default)",
              }}
              target="_blank"
            >
              Homepage
            </a>
          )}
          {!entry.repository && !entry.homepage && (
            <span
              style={{
                fontSize: "13px",
                color: "var(--color-text-muted)",
              }}
            >
              No links available
            </span>
          )}
        </div>
      </div>

      {/* Keywords */}
      {entry.keywords && entry.keywords.length > 0 && (
        <div>
          <h3
            style={{
              fontSize: "14px",
              fontWeight: 600,
              marginBottom: "8px",
              color: "var(--color-text-primary)",
            }}
          >
            Keywords
          </h3>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {entry.keywords.map((kw) => (
              <span
                key={kw}
                style={{
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "12px",
                  backgroundColor: "var(--color-bg-subtle)",
                  color: "var(--color-text-secondary)",
                }}
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
