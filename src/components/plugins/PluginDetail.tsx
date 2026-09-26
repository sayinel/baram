import type { PluginSource } from "../../plugins/plugin-sources";
import type { RevocationEntry } from "../../plugins/revocation";
import type {
  PluginCapability,
  PluginStatus,
  RegistryEntry,
} from "../../plugins/types";

import { ArrowLeft } from "lucide-react";

// §69 Plugin Detail Panel — Full info view for a selected plugin
import { useTranslation } from "../../i18n/useTranslation";
import { actionsFor } from "../../plugins/plugin-sources";
import { safeLinkHref } from "../ai/markdown-url";
import MarkdownRenderer from "../ai/MarkdownRenderer";
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
    <div className="plugin-detail">
      {/* Back button */}
      <button className="plugin-detail__back-btn" onClick={onBack}>
        <ArrowLeft className="icon-inline" size="1em" />
        {t("plugin.action.back")}
      </button>

      {/* §69 — genuinely first in the body now. The earlier version carried a comment
          saying so while rendering after the description, the error banner and the
          action buttons; review caught the comment describing an intent the code did
          not implement. */}
      {/* Gated like the row's copy: the same callback reaching a source that cannot
          remove is the same defect on this screen, and this screen now knows `can`. */}
      <PluginRevokedNotice
        name={entry.name}
        onRemove={can.canRemove ? onUninstall : undefined}
        revocation={revocation ?? null}
      />

      {/* Header */}
      <div className="plugin-detail__header">
        {entry.icon && (
          <span className="plugin-detail__icon">{entry.icon}</span>
        )}
        <div>
          <h2 className="plugin-detail__title">{entry.name}</h2>
          <div className="plugin-detail__meta-row">
            <span className="plugin-detail__meta">{entry.author}</span>
            <span className="plugin-detail__meta">v{entry.version}</span>
            <span className="plugin-detail__license">{entry.license}</span>
          </div>
          {/* ‼️ A POSITIVE SIGNAL, matching the row's chip. Without it a built-in's detail
              screen differed from a community plugin's only by the ABSENCE of Update and
              Uninstall — and an absence explains nothing: it reads the same as a plugin
              whose update simply has not been found yet. `PluginRow` says "Built-in" here
              and this screen is reached from that row, so saying it twice is what makes
              the two surfaces one story. */}
          <div className="plugin-detail__trust-row">
            <PluginTrustBadge trust={entry.trust} />
            {source === "builtin" && (
              <span className="plugin-detail__badge">
                {t("plugin.builtin.badge")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && <div className="plugin-detail__error">{error}</div>}

      {/* Action buttons */}
      <div className="plugin-detail__actions">
        {status === "installing" ? (
          <button className="plugin-detail__installing-btn" disabled>
            {t("plugin.action.installing")}
          </button>
        ) : status === "enabled" || status === "disabled" ? (
          <>
            {/* ‼️ `can.canToggle`, not the status branch. The branch answers a different
                question — "is this thing installed enough to act on" — and reading the
                toggle off it made this the one action here NOT decided by `actionsFor`,
                while `canUpdate` and `canRemove` below both go through `can`. No live
                defect: only `builtin` and `community` reach this screen and both toggle.
                It becomes one the moment a dev row does, which is a planned follow-up,
                and it would arrive as a control that does nothing. */}
            {can.canToggle && (
              <button
                className={
                  status === "enabled"
                    ? "plugin-detail__toggle-btn plugin-detail__toggle-btn--enabled"
                    : "plugin-detail__toggle-btn"
                }
                onClick={onToggleEnabled}
              >
                {status === "enabled"
                  ? t("plugin.action.enabled")
                  : t("plugin.action.disabled")}
              </button>
            )}
            {can.canUpdate && updateAvailable && (
              <button className="plugin-detail__update-btn" onClick={onUpdate}>
                {t("plugin.action.updateTo", { version: updateAvailable })}
              </button>
            )}
            {can.canRemove && (
              <button
                className="plugin-detail__remove-btn"
                onClick={onUninstall}
              >
                {t("plugin.action.uninstall")}
              </button>
            )}
          </>
        ) : source === "builtin" ? null : ( // compiled in — nothing to acquire
          <div className="plugin-detail__install-col">
            {legacy && (
              <p className="plugin-legacy-note">
                {legacyEntryMessage(entry, t)}
              </p>
            )}
            <button
              className="plugin-detail__install-btn"
              disabled={legacy}
              onClick={onInstall}
            >
              {t("plugin.action.install")}
            </button>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="plugin-detail__section">
        <h3 className="plugin-detail__section-title">
          {t("plugin.detail.description")}
        </h3>
        <p className="plugin-detail__description">{entry.description}</p>
      </div>

      {/* README */}
      {readme && (
        <div className="plugin-detail__section">
          <h3 className="plugin-detail__section-title">
            {t("plugin.detail.readme")}
          </h3>
          {/* ‼️ Rendered, not dumped. This was a `<pre>` holding the raw source, so a
              markdown editor showed a markdown document with its headings, links and code
              fences as plain text. `MarkdownRenderer` is the same component AI chat output
              uses, and it sanitises link and image URLs — but note this call site takes the
              UNTRUSTED default while chat opts into `trust="trusted"`, because this content
              comes from a plugin author. The 300px clamp is gone with it: this screen now
              owns a whole editor tab. */}
          <div className="plugin-detail-readme">
            <MarkdownRenderer content={readme} />
          </div>
        </div>
      )}

      {/* §260 Phase 4c — declared settings, above Capabilities: it is the only section a
          user ACTS on, and it renders itself away for a plugin that declares none. Driven
          by the installed MANIFEST rather than by `entry`, because a registry entry carries
          no contributions — the questions are asked by the code that is installed. */}
      <PluginSettingsForm pluginId={entry.id} />

      {/* Capabilities */}
      <div className="plugin-detail__section">
        <h3 className="plugin-detail__section-title">
          {t("plugin.detail.capabilities")}
        </h3>
        <div className="plugin-detail__caps">
          {entry.capabilities.map((cap) => (
            <PluginCapabilityBadge
              capability={cap as PluginCapability}
              key={cap}
              showDescription
            />
          ))}
          {entry.capabilities.length === 0 && (
            <span className="plugin-detail__none">
              {t("plugin.detail.capabilitiesNone")}
            </span>
          )}
        </div>
      </div>

      {/* Links */}
      <div className="plugin-detail__section">
        <h3 className="plugin-detail__section-title">
          {t("plugin.detail.links")}
        </h3>
        <div className="plugin-detail__links">
          {entry.repository && (
            <a
              className="plugin-detail__link"
              href={safeLinkHref(entry.repository)}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t("plugin.detail.repository")}
            </a>
          )}
          {entry.homepage && (
            <a
              className="plugin-detail__link"
              href={safeLinkHref(entry.homepage)}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t("plugin.detail.homepage")}
            </a>
          )}
          {!entry.repository && !entry.homepage && (
            <span className="plugin-detail__none">
              {t("plugin.detail.linksNone")}
            </span>
          )}
        </div>
      </div>

      {/* Keywords */}
      {entry.keywords && entry.keywords.length > 0 && (
        <div>
          <h3 className="plugin-detail__section-title">
            {t("plugin.detail.keywords")}
          </h3>
          <div className="plugin-detail__keywords">
            {entry.keywords.map((kw) => (
              <span className="plugin-detail__keyword" key={kw}>
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
