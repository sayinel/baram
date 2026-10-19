// §394 spec 0073 D14 · D10 · D11 · plan 0126 P5 · P6 · P15 — a sandboxed panel on the sidebar's plugin
// seat: the root outside the plugin's reach, the host-drawn header with the source, the empty state and
// the error line, and the native-menu policy over its output.
import type { RenderedSidebarPanel } from "../../../plugins/plugin-ui-store";

import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNativeContextMenuPolicy } from "../../../hooks/use-native-context-menu-policy";
import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { PANEL_UPDATE_INTERVAL_MS } from "../../../plugins/rendered/limits";
import {
  __resetPanelContents,
  openPanel,
  setPanelContent,
} from "../../../plugins/rendered/panel-contents";
import { PluginPanelHost } from "../PluginPanelHost";

const PANEL: RenderedSidebarPanel = {
  kind: "rendered",
  panelId: "sb:live",
  pluginId: "sb",
  sourceName: "SB",
  title: "Live",
};

/** The plugin seat showing PANEL, as the activity bar leaves it after a click. */
function show() {
  usePluginUIStore.setState({
    activePluginPanelId: PANEL.panelId,
    sidebarPanels: [PANEL],
  });
  return render(<PluginPanelHost />);
}

const shadowIn = (root: ParentNode) =>
  root.querySelector(".plugin-block-host")!.shadowRoot!;

beforeEach(() => {
  __resetPanelContents();
  openPanel(PANEL.panelId);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  usePluginUIStore.setState({ activePluginPanelId: null, sidebarPanels: [] });
});

describe("RenderedPanelView", () => {
  /** D10 — the containment root and the header are the host's, outside the shadow root the plugin's
   *  CSS lives in. What fails this: content drawn into the root itself (the plugin's CSS could then
   *  select the root and the header), or a header without the source. */
  it("draws the content in a shadow root under a host-drawn root and header", () => {
    setPanelContent(PANEL.panelId, { html: "<p>hi</p>" });
    const { container } = show();
    const root = container.querySelector("[data-plugin-panel]")!;
    expect(root.getRootNode()).toBe(document);
    expect(root.querySelector(".plugin-panel-title")?.textContent).toBe("Live");
    expect(root.querySelector(".plugin-panel-source")?.textContent).toBe(
      "Plugin · SB",
    );
    const host = root.querySelector(".plugin-panel-body > .plugin-block-host");
    expect(host?.shadowRoot?.innerHTML).toBe("<p>hi</p>");
    expect(root.querySelector("p")).toBeNull();
  });

  /** P6 — before the first content the host says so; the content replaces that. The seat's own
   *  "no panel selected" state shares the `.plugin-panel-empty` class (`PluginPanelHost`), so this row
   *  finds the node by its own text — neither row can pass on the other's node. */
  it("shows the empty state until the first content", () => {
    const { container } = show();
    expect(
      screen.getByText("This panel has nothing to show yet."),
    ).toBeTruthy();
    act(() => {
      setPanelContent(PANEL.panelId, { html: "<p>now</p>" });
    });
    expect(
      screen.queryByText("This panel has nothing to show yet."),
    ).toBeNull();
    expect(shadowIn(container).innerHTML).toBe("<p>now</p>");
  });

  /** §6 · P8 — the error line carries the code block's sentence, and the body fades while it keeps
   *  the last drawing. What fails this: an error line without the shared sentence, or no fading. */
  it("shows a refused draw's sentence and fades the last drawing", () => {
    vi.useFakeTimers();
    setPanelContent(PANEL.panelId, { html: "<p>ok</p>" });
    const { container } = show();
    act(() => {
      setPanelContent(PANEL.panelId, {
        css: ":host{color:red}",
        html: "<p>bad</p>",
      });
      vi.advanceTimersByTime(PANEL_UPDATE_INTERVAL_MS);
    });
    expect(container.querySelector(".plugin-panel-error")?.textContent).toBe(
      "Render failed — rendered CSS was refused (selectorNotAllowed)",
    );
    expect(
      container
        .querySelector(".plugin-panel-body")
        ?.classList.contains("plugin-panel-stale"),
    ).toBe(true);
    expect(shadowIn(container).innerHTML).toBe("<p>ok</p>");
  });

  /** D11 이유 칸 · P15 — the panel is chrome: in a release build no native menu opens over its output,
   *  an element in a shadow tree under a `contenteditable="false"` host. What fails this: a policy
   *  that no longer prevents outside editable areas, a panel that keeps the event from `document`
   *  (a `stopPropagation` on its root), or an editable host (`contenteditable="true"`) under a policy
   *  that reads `event.target` or lets `closest("[contenteditable]")` cross the shadow boundary.
   *  Either of those two policy changes alone keeps this row green — the host they reach says
   *  "false"; the policy's own "sees through Shadow DOM" row fails on `event.target`. The pair: a
   *  development build keeps the menu (Inspect Element). */
  it("lets no native menu open over the output in a release build", () => {
    setPanelContent(PANEL.panelId, { html: '<a data-note="a.md">a</a>' });
    renderHook(() => useNativeContextMenuPolicy());
    const { container } = show();
    const link = shadowIn(container).querySelector("a")!;
    vi.stubEnv("DEV", false);
    expect(fireEvent.contextMenu(link)).toBe(false);
    vi.stubEnv("DEV", true);
    expect(fireEvent.contextMenu(link)).toBe(true);
  });
});
