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

const MODIFIER: Record<PluginTrust, string> = {
  sandboxed: "plugin-trust-badge--sandboxed",
  trusted: "plugin-trust-badge--trusted",
};

export function PluginTrustBadge({
  trust,
}: {
  trust: PluginTrust | undefined;
}) {
  const { t } = useTranslation();
  const label = trust ? t(LABEL_KEY[trust]) : t("plugin.trust.legacy");
  // The no-trust modifier is named after the label it renders, `plugin.trust.legacy`.
  const modifier = trust ? MODIFIER[trust] : "plugin-trust-badge--legacy";
  return <span className={`plugin-trust-badge ${modifier}`}>{label}</span>;
}
