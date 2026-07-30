// §69 Plugin Capability Badge
import type { PluginCapability } from "../../plugins/types";

import { useTranslation } from "../../i18n/useTranslation";
import { capabilityLabel } from "./capability-label";

const CAPABILITY_COLORS: Record<string, string> = {
  editor: "#3b82f6",
  "editor:readonly": "#60a5fa",
  files: "#f59e0b",
  "files:readonly": "#fbbf24",
  commands: "#8b5cf6",
  sidebar: "#6366f1",
  statusbar: "#6366f1",
  settings: "#6b7280",
  events: "#10b981",
  ai: "#ec4899",
  network: "#ef4444",
  storage: "#14b8a6",
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
  const color = CAPABILITY_COLORS[capability] ?? "#6b7280";
  return (
    <span
      className="plugin-capability-badge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 8px",
        borderRadius: "9999px",
        fontSize: "11px",
        fontWeight: 500,
        backgroundColor: `${color}18`,
        color,
        border: `1px solid ${color}30`,
        lineHeight: "18px",
      }}
      title={description}
    >
      {capability}
      {showDescription && (
        <span style={{ opacity: 0.8, fontSize: "10px" }}>— {description}</span>
      )}
    </span>
  );
}
