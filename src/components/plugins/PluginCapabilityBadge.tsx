// §69 Plugin Capability Badge
import type { CSSProperties } from "react";

import type { PluginCapability } from "../../plugins/types";

import { useTranslation } from "../../i18n/useTranslation";
import { capabilityLabel } from "./capability-label";

/**
 * The hue each capability is drawn in. The readable text and fill are mixed FROM it
 * by `.plugin-capability-badge` in plugins.css, per light/dark base (#330).
 *
 * `Record<PluginCapability, string>` and not `Record<string, string>`: the union
 * gained `viewer` in v0.5.0 and this map did not, so viewer capabilities fell to the
 * `?? grey` default — the same grey as `settings`, making two capabilities
 * indistinguishable. The compiler now refuses the next addition instead.
 */
const CAPABILITY_COLORS: Record<PluginCapability, string> = {
  ai: "#ec4899",
  commands: "#8b5cf6",
  editor: "#3b82f6",
  "editor:readonly": "#60a5fa",
  events: "#10b981",
  files: "#f59e0b",
  "files:readonly": "#fbbf24",
  network: "#ef4444",
  settings: "#6b7280",
  sidebar: "#6366f1",
  statusbar: "#6366f1",
  storage: "#14b8a6",
  viewer: "#0ea5e9",
};

interface PluginCapabilityBadgeProps {
  capability: PluginCapability;
  showDescription?: boolean;
}

export function PluginCapabilityBadge({
  capability,
  showDescription,
}: PluginCapabilityBadgeProps) {
  // Same source as the consent dialog: the description used to come straight from
  // `CAPABILITY_DESCRIPTIONS`, which is written in Korean, so this badge's tooltip and its
  // inline text stayed Korean in the English UI.
  const { t } = useTranslation();
  const description = capabilityLabel(capability, t);
  // The one value that varies per badge. Everything derived from it — text, fill,
  // border — is computed in CSS, where the light/dark recipe already switches with
  // the theme and needs no base plumbed through React.
  const hue = { "--capability-badge-hue": CAPABILITY_COLORS[capability] };
  return (
    <span
      className="plugin-capability-badge"
      style={hue as CSSProperties}
      title={description}
    >
      {capability}
      {showDescription && (
        <span className="plugin-capability-badge__description">
          — {description}
        </span>
      )}
    </span>
  );
}
