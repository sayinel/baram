// §394 spec 0073 D14 · plan 0126 P4 · P14 · P23 — what each sandboxed panel last received, kept as it
// was sent. Counted, never timed.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { unregisterPluginUI } from "../../trusted/ui-api";
import {
  __resetPanelContents,
  closePanel,
  openPanel,
  panelContent,
  panelKey,
  releasePanels,
  setPanelContent,
  subscribePanel,
} from "../panel-contents";

beforeEach(() => __resetPanelContents());

describe("panel contents", () => {
  /** P23 — what fails this: a store that takes content for a panel nobody opened; a request still
   *  in flight after the plugin's release could then write its panel back. The pair: an open panel
   *  keeps the last content, numbered. */
  it("keeps content only for an open panel — the last one, with a counting sequence", () => {
    expect(setPanelContent("sb:live", { html: "<p>0</p>" })).toBe(false);
    expect(panelContent("sb:live")).toBeNull();
    openPanel(panelKey("sb", "live"));
    expect(panelContent("sb:live")).toBeNull();
    expect(setPanelContent("sb:live", { html: "<p>1</p>" })).toBe(true);
    expect(setPanelContent("sb:live", { css: "p{}", html: "<p>2</p>" })).toBe(
      true,
    );
    expect(panelContent("sb:live")).toEqual({
      content: { css: "p{}", html: "<p>2</p>" },
      seq: 2,
    });
  });

  /** Listeners are per panel. What fails this: one listener list for every panel (each update would
   *  wake every listener). */
  it("tells a panel's listeners, and only that panel's", () => {
    openPanel("sb:live");
    openPanel("sb:other");
    const live = vi.fn();
    const other = vi.fn();
    const stop = subscribePanel("sb:live", live);
    subscribePanel("sb:other", other);
    setPanelContent("sb:live", { html: "" });
    expect(live).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    stop();
    setPanelContent("sb:live", { html: "x" });
    expect(live).toHaveBeenCalledTimes(1);
  });

  /** P14 — a release takes every panel of one plugin by the `${pluginId}:` prefix, and no other
   *  plugin's (`sb-2:` does not start with `sb:` — a plugin id holds no `:`). What fails this: a
   *  release by bare prefix `sb`, or none. */
  it("releases every panel of one plugin, and closes one panel", () => {
    openPanel(panelKey("sb", "a"));
    openPanel(panelKey("sb", "b"));
    openPanel(panelKey("sb-2", "a"));
    releasePanels("sb");
    expect(setPanelContent("sb:a", { html: "" })).toBe(false);
    expect(setPanelContent("sb:b", { html: "" })).toBe(false);
    expect(setPanelContent("sb-2:a", { html: "" })).toBe(true);
    closePanel("sb-2:a");
    expect(setPanelContent("sb-2:a", { html: "" })).toBe(false);
    expect(panelContent("sb-2:a")).toBeNull();
  });

  /** P9 — `unregisterPluginUI` releases a plugin's panels. */
  it("is released by unregisterPluginUI", () => {
    openPanel("sb:live");
    setPanelContent("sb:live", { html: "<p>x</p>" });
    unregisterPluginUI("sb");
    expect(panelContent("sb:live")).toBeNull();
    expect(setPanelContent("sb:live", { html: "" })).toBe(false);
  });
});
