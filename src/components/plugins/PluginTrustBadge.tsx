import type { PluginTrust } from "../../plugins/types";

// §260 — tier badge shown in the plugin install UI.
const LABEL: Record<PluginTrust, string> = {
  sandboxed: "Sandboxed",
  trusted: "Full trust",
};

const COLOR: Record<PluginTrust, string> = {
  sandboxed: "var(--color-accent-default)",
  trusted: "var(--color-status-danger)",
};

export function PluginTrustBadge({
  trust,
}: {
  trust: PluginTrust | undefined;
}) {
  const label = trust ? LABEL[trust] : "Legacy — needs re-validation";
  const color = trust ? COLOR[trust] : "var(--color-text-muted)";
  return (
    <span
      style={{
        alignSelf: "flex-start",
        border: `1px solid ${color}`,
        borderRadius: "4px",
        color,
        fontSize: "12px",
        fontWeight: 500,
        padding: "2px 8px",
      }}
    >
      {label}
    </span>
  );
}
