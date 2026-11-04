// §69 Host slot for the active plugin-contributed sidebar panel (§5.3). §394 plan 0126 P5 — a trusted
// panel mounts its own DOM (`PluginShadowMount`); a sandboxed one is drawn by the host
// (`RenderedPanelView`).
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { PluginShadowMount } from "../plugins/PluginShadowMount";
import { RenderedPanelView } from "./RenderedPanelView";

export function PluginPanelHost() {
  const { t } = useTranslation();
  const { activePluginPanelId, sidebarPanels } = usePluginUIStore(
    useShallow((s) => ({
      activePluginPanelId: s.activePluginPanelId,
      sidebarPanels: s.sidebarPanels,
    })),
  );
  const panel = sidebarPanels.find((p) => p.panelId === activePluginPanelId);
  if (!panel) {
    return <div className="plugin-panel-empty">{t("plugin.panel.none")}</div>;
  }
  if (panel.kind === "rendered") {
    return <RenderedPanelView key={panel.panelId} panel={panel} />;
  }
  return (
    <PluginShadowMount
      key={panel.panelId}
      onMount={panel.onMount}
      onUnmount={panel.onUnmount}
    />
  );
}
