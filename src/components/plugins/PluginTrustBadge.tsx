import type { PluginTrust } from "../../plugins/types";

import { useTranslation } from "../../i18n/useTranslation";

// §260 — tier badge shown in the plugin install UI.
//
// The label wording tracks the consent dialog on purpose: `plugin.trust.trusted`
// is the badge-length form of the same term `plugin.consent.fullTrust.title` uses,
// so the tier a user reads on the card is the tier they are asked to accept.
const LABEL_KEY: Record<PluginTrust, string> = {
  sandboxed: "plugin.trust.sandboxed",
  trusted: "plugin.trust.trusted",
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
  const { t } = useTranslation();
  const label = trust ? t(LABEL_KEY[trust]) : t("plugin.trust.legacy");
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
