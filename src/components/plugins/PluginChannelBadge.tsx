import type { RegistryChannel } from "../../plugins/types";

import { useTranslation } from "../../i18n/useTranslation";

// §382 — who distributes this plugin, as one chip on every surface that lists one. The same
// full-key table `PluginTrustBadge` uses, for the same reason: `plugin-ui-i18n.test.tsx`
// sees only literal keys.
const LABEL_KEY: Record<RegistryChannel, string> = {
  community: "plugin.channel.community",
  "first-party": "plugin.channel.firstParty",
};

export function PluginChannelBadge({ channel }: { channel: RegistryChannel }) {
  const { t } = useTranslation();
  return <span className="plugin-channel-badge">{t(LABEL_KEY[channel])}</span>;
}
