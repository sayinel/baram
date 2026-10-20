// §394 spec 0073 §6 · D14 — the refusals that belong to a sandboxed plugin's panels — an undeclared id,
// a closed panel, an update past the acceptance bucket — in one home, so a plugin meets the same
// sentence for an undeclared id whichever side refuses it. (A panel request meets two refusals that are
// not panel-specific and live with their rules: the capability gate's, `capability-gate.ts`, and the
// size caps', `renderedContentProblem`.) The sandbox client refuses an undeclared id with them at once
// (`sandbox-ui.ts`) and the host again (`host-ui-bridge.ts`); the closed-panel and the rate refusals
// are the host's alone. It imports only `limits.ts`, itself a leaf: the sandbox realm imports it.

import { PANEL_UPDATE_BURST, PANEL_UPDATE_INTERVAL_MS } from "./limits";

/** plan 0126 P23 — a `ui_set_panel` for panel `id` after its release (or before its registration). The host's only. */
export function closedPanelMessage(id: string): string {
  return `ui.setPanel: panel "${id}" is not open`;
}

/** plan 0126 P34 — a `ui_set_panel` past panel `id`'s acceptance bucket. The host's only. */
export function panelRateMessage(id: string): string {
  return `ui.setPanel: panel "${id}" is updated too often — at most ${PANEL_UPDATE_BURST} at once, then ${1000 / PANEL_UPDATE_INTERVAL_MS} a second`;
}

/** `setPanel` / `onPanelAction` naming a panel the manifest does not declare. */
export function undeclaredPanelMessage(
  method: "onPanelAction" | "setPanel",
  id: string,
): string {
  return `ui.${method}: panel "${id}" is not declared in contributions.panels`;
}
