// §69 Host slot for the active plugin-contributed sidebar panel (§5.3)
import { useShallow } from "zustand/shallow";

import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { PluginShadowMount } from "../plugins/PluginShadowMount";

export function PluginPanelHost() {
  const { activePluginPanelId, sidebarPanels } = usePluginUIStore(
    useShallow((s) => ({
      activePluginPanelId: s.activePluginPanelId,
      sidebarPanels: s.sidebarPanels,
    })),
  );
  const panel = sidebarPanels.find((p) => p.panelId === activePluginPanelId);
  if (!panel) {
    return <div className="plugin-panel-empty">No plugin panel selected.</div>;
  }
  return (
    <PluginShadowMount
      key={panel.panelId}
      onMount={panel.onMount}
      onUnmount={panel.onUnmount}
    />
  );
}
