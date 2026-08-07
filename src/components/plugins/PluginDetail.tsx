import type { PluginSource } from "../../plugins/plugin-sources";
import type { RevocationEntry } from "../../plugins/revocation";
import type {
  PluginCapability,
  PluginStatus,
  RegistryEntry,
} from "../../plugins/types";

// §69 Plugin Detail Panel — Full info view for a selected plugin
import { useTranslation } from "../../i18n/useTranslation";
import { actionsFor } from "../../plugins/plugin-sources";
import { legacyEntryMessage } from "./legacy-entry-message";
import { PluginCapabilityBadge } from "./PluginCapabilityBadge";
import { PluginRevokedNotice } from "./PluginRevokedNotice";
import { PluginSettingsForm } from "./PluginSettingsForm";
import { PluginTrustBadge } from "./PluginTrustBadge";

interface PluginDetailProps {
  entry: RegistryEntry;
  error?: string;
  onBack: () => void;
  onInstall: () => void;
  onToggleEnabled: () => void;
  onUninstall: () => void;
  onUpdate: () => void;
  readme?: null | string;
  revocation?: null | RevocationEntry;
  /**
   * ‼️ Where the plugin came from, so this screen offers the same action set the row does.
   *
   * Optional and defaulting to `community` because every other caller renders a REGISTRY
   * listing, which is what community means. The Installed tab is the one route that can
   * reach a built-in, and a built-in is never in `installedPlugins` — it is compiled in,
   * not installed — so without this `status` read "not-installed" and this screen offered
   * an enabled Install button wired to an entry whose `downloadUrl` is `""`.
   */
  source?: PluginSource;
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
  revocation,
  source = "community",
}: PluginDetailProps) {
  const { t } = useTranslation();
  // The same single authority the rows use (§3.1). Install is not in that table — it is a
  // property of a registry listing rather than of an installed row — so it is gated below
  // on the source directly.
  const can = actionsFor(source);
  // The full-trust warning moved to `PluginConsentDialog` (§260 Phase 5), which is the
  // step that actually records what the user agreed to. Keeping a second, weaker warning
  // here would have let the two drift apart.
  const legacy = !entry.trust;

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
        {t("plugin.action.back")}
      </button>

      {/* §69 — genuinely first in the body now. The earlier version carried a comment
          saying so while rendering after the description, the error banner and the
          action buttons; review caught the comment describing an intent the code did
          not implement. */}
      <PluginRevokedNotice
        onRemove={onUninstall}
        revocation={revocation ?? null}
      />

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
          <div style={{ marginTop: "6px" }}>
            <PluginTrustBadge trust={entry.trust} />
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
            // Checksums are unbroken 64-char tokens — without this they
            // overflow the banner horizontally.
            overflowWrap: "anywhere",
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
            {t("plugin.action.installing")}
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
                    ? "var(--color-accent-solid)"
                    : "var(--color-bg-subtle)",
                color:
                  status === "enabled"
                    ? "var(--color-accent-on-solid)"
                    : "var(--color-text-primary)",
                border:
                  status === "enabled"
                    ? "none"
                    : "1px solid var(--color-border-default)",
                cursor: "pointer",
              }}
            >
              {status === "enabled"
                ? t("plugin.action.enabled")
                : t("plugin.action.disabled")}
            </button>
            {can.canUpdate && updateAvailable && (
              <button
                onClick={onUpdate}
                style={{
                  padding: "8px 20px",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 500,
                  backgroundColor: "var(--color-status-warning)",
                  color: "var(--color-status-warning-on-solid)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {t("plugin.action.updateTo", { version: updateAvailable })}
              </button>
            )}
            {can.canRemove && (
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
                {t("plugin.action.uninstall")}
              </button>
            )}
          </>
        ) : source === "builtin" ? null : ( // compiled in — nothing to acquire
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {legacy && (
              <p className="plugin-legacy-note">
                {legacyEntryMessage(entry, t)}
              </p>
            )}
            <button
              disabled={legacy}
              onClick={onInstall}
              style={{
                alignSelf: "flex-start",
                padding: "8px 20px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 500,
                backgroundColor: "var(--color-accent-solid)",
                color: "var(--color-accent-on-solid)",
                border: "none",
                cursor: legacy ? "not-allowed" : "pointer",
                opacity: legacy ? 0.5 : 1,
              }}
            >
              {t("plugin.action.install")}
            </button>
          </div>
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
          {t("plugin.detail.description")}
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
            {t("plugin.detail.readme")}
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

      {/* §260 Phase 4c — declared settings, above Capabilities: it is the only section a
          user ACTS on, and it renders itself away for a plugin that declares none. Driven
          by the installed MANIFEST rather than by `entry`, because a registry entry carries
          no contributions — the questions are asked by the code that is installed. */}
      <PluginSettingsForm pluginId={entry.id} />

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
          {t("plugin.detail.capabilities")}
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
              {t("plugin.detail.capabilitiesNone")}
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
          {t("plugin.detail.links")}
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
              {t("plugin.detail.repository")}
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
              {t("plugin.detail.homepage")}
            </a>
          )}
          {!entry.repository && !entry.homepage && (
            <span
              style={{
                fontSize: "13px",
                color: "var(--color-text-muted)",
              }}
            >
              {t("plugin.detail.linksNone")}
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
            {t("plugin.detail.keywords")}
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
