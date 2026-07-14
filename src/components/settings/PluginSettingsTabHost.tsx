// §69 Host for one plugin-contributed Settings tab (§5.4), Shadow-isolated
import { useShallow } from "zustand/shallow";

import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { PluginShadowMount } from "../plugins/PluginShadowMount";

export function PluginSettingsTabHost({ tabId }: { tabId: string }) {
  const tab = usePluginUIStore(
    useShallow((s) => s.settingsTabs.find((t) => t.tabId === tabId)),
  );
  if (!tab) return null;
  return (
    <PluginShadowMount
      key={tab.tabId}
      onMount={tab.onMount}
      onUnmount={tab.onUnmount}
    />
  );
}
