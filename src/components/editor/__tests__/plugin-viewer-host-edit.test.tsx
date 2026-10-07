// §392 spec 0071 §5 · §6.4 · §6.5 · §7 · §10 (자격 · 되먹임 · 수명) — the host's editing mount,
// driven through the harness: which mount a file gets, which changes reach the viewer, and what
// happens on the way down.
import { StrictMode, useMemo } from "react";

import type { PluginFileViewer } from "../../../plugins/plugin-ui-store";
import type { ViewerDouble } from "./viewer-edit-fixtures";

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSourceMode } from "../../../hooks/use-source-mode";
import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { hasPendingViewerEdit } from "../../../plugins/viewer-edit-mounts";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { resolveSurfaceKind } from "../../../utils/editor/surface-kind";
import { isViewerEditableFile } from "../../../utils/file-type";
import { logger } from "../../../utils/logger";
import { PluginViewerHost } from "../PluginViewerHost";
import {
  count,
  draw,
  fill,
  harnessProps,
  lastEdit,
  newProbe,
  PATH,
  seedStores,
  sketchTab,
  TAB,
  viewerDouble,
} from "./viewer-edit-fixtures";
import { ViewerEditHarness } from "./viewer-edit-harness";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  updateFileIndex: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

let events: string[];

beforeEach(() => {
  events = [];
  vi.restoreAllMocks();
});

function open(double: ViewerDouble, tabs = [sketchTab()], active = TAB) {
  seedStores(tabs, active);
  usePluginUIStore.getState().registerFileViewer(double.viewer);
  return render(<ViewerEditHarness {...harnessProps(newProbe(events))} />);
}

/** Open the sketch tab, fill its buffer with T0, and forget the mount's own events. */
function mounted(): ViewerDouble {
  const double = viewerDouble(events);
  open(double);
  act(() => fill(TAB, "T0"));
  events.length = 0;
  return double;
}

describe("which mount a file gets (§5)", () => {
  it("mounts nothing for a text file whose buffer is not filled — not even draw-only — then once with the buffer's text", () => {
    const double = viewerDouble(events);
    open(double);
    expect(count(events, "onMount")).toBe(0);
    act(() => fill(TAB, "T0"));
    expect(count(events, "onMount")).toBe(1);
    expect(lastEdit(double).text).toBe("T0");
    expect(lastEdit(double).tabId).toBe(TAB);
    expect(count(events, "onUpdate")).toBe(0);
  });

  it("mounts an image draw-only, with no ctx.edit, although the viewer is editable", () => {
    const double = viewerDouble(events, { extensions: ["png"] });
    open(double, [sketchTab(TAB, "/v/p.png")]);
    expect(count(events, "onMount")).toBe(1);
    expect(double.contexts[0].edit).toBeUndefined();
  });

  it("mounts an .html file draw-only, with no ctx.edit", () => {
    const double = viewerDouble(events, { extensions: ["html"] });
    open(double, [sketchTab(TAB, "/v/page.html")]);
    expect(count(events, "onMount")).toBe(1);
    expect(double.contexts[0].edit).toBeUndefined();
  });

  it("gives a viewer that is not editable no ctx.edit on a text file, and does not wait for the buffer", () => {
    const double = viewerDouble(events, { editable: false });
    open(double);
    expect(count(events, "onMount")).toBe(1);
    expect(double.contexts[0].edit).toBeUndefined();
  });

  it("never hands markdown or a PDF to a viewer", () => {
    const { viewer } = viewerDouble(events, { extensions: ["md", "pdf"] });
    for (const [filePath, kind] of [
      ["/v/n.md", "markdown"],
      ["/v/d.pdf", "pdf"],
    ] as const) {
      expect(
        resolveSurfaceKind({
          activeTabId: TAB,
          fileViewers: [viewer],
          isHtmlSourceView: false,
          isSourceMode: false,
          rootPath: "/v",
          tab: sketchTab(TAB, filePath),
        }),
      ).toBe(kind);
      expect(isViewerEditableFile(filePath)).toBe(false);
    }
  });
});

describe("what reaches an editing mount (§6.4 · §6.5 · D10)", () => {
  it("nothing for its own save: the refresh key moves, no onUpdate", () => {
    mounted();
    act(() => useFileStore.getState().updateLastSaveMtime(PATH, 1234));
    expect(count(events, "onUpdate")).toBe(0);
  });

  it("a draw-only mount still gets onUpdate for a refresh, as before §392 (the positive half)", () => {
    const double = viewerDouble(events, { extensions: ["png"] });
    open(double, [sketchTab(TAB, "/v/p.png")]);
    events.length = 0;
    act(() => useFileStore.getState().updateLastSaveMtime("/v/p.png", 1234));
    expect(events).toEqual(["onUpdate"]);
    expect(double.contexts.at(-1)?.refreshKey).toBe(1234);
  });

  // Both settings-store `act` calls in this describe (the two zoom rows) have block bodies. The
  // store's setters return the persist middleware's `setItem()` promise; an arrow that returns
  // it puts `act` in async mode, which nobody awaits. Measured with the arrow form (plan 0121
  // Task 7): the zoom rendered after the assertions, and the act queue left open kept effects
  // from running in every row after it in this file — ten then, each failing in `fill` with no
  // buffer access registered (`use-settings-effects-theme-chrome.test.tsx` notes the same).
  it("a zoom with a pending change: one take, then one onUpdate carrying it, with the mount's same markChanged (§4)", () => {
    const double = mounted();
    act(() => draw(double, "T1"));
    act(() => {
      useSettingsStore.getState().setZoomLevel(1.25);
    });
    expect(events).toEqual(["getText", "onUpdate"]);
    expect(lastEdit(double).text).toBe("T1");
    expect(double.contexts.at(-1)?.zoomLevel).toBe(1.25);
    // Spec §4: one `markChanged` per mount — a viewer may keep the one onMount gave it.
    expect(double.contexts).toHaveLength(2);
    expect(double.contexts[0].edit?.markChanged).toBeTypeOf("function");
    expect(double.contexts[1].edit?.markChanged).toBe(
      double.contexts[0].edit?.markChanged,
    );
  });

  it("N zoom ticks with a pending change: getText once, onUpdate N times", () => {
    const double = mounted();
    act(() => draw(double, "T1"));
    for (const zoom of [1.1, 1.2, 1.3]) {
      act(() => {
        useSettingsStore.getState().setZoomLevel(zoom);
      });
    }
    expect(count(events, "getText")).toBe(1);
    expect(count(events, "onUpdate")).toBe(3);
  });

  it("another writer's text once, and nothing for the text the buffer already holds", () => {
    const double = mounted();
    act(() => fill(TAB, "T2"));
    expect(events).toEqual(["onUpdate"]);
    expect(lastEdit(double).text).toBe("T2");
    act(() => fill(TAB, "T2"));
    expect(events).toEqual(["onUpdate"]);
  });

  it("the first text again, when another writer restores it after a take made T1", () => {
    const double = mounted();
    act(() => draw(double, "T1"));
    act(() => {
      useEditorStore.getState().sourceBufferAccess?.getSourceBuffer(TAB);
    });
    act(() => fill(TAB, "T0"));
    expect(events).toEqual(["getText", "onUpdate"]);
    expect(lastEdit(double).text).toBe("T0");
  });

  it("a markChanged inside onMount stays pending through a fill of the same text, and gives way to a different one (§6.4)", () => {
    // Annotated: the initializer refers to `double` (inside onMount), which TypeScript cannot
    // type from the initializer itself.
    const double: ViewerDouble = viewerDouble(events, {
      onMount: (_el, ctx) => {
        events.push("onMount");
        double.contexts.push(ctx);
        double.model = "M1";
        ctx.edit?.markChanged();
      },
    });
    open(double);
    act(() => fill(TAB, "T0"));
    expect(hasPendingViewerEdit(TAB)).toBe(true);
    events.length = 0;
    act(() => fill(TAB, "T0"));
    expect(events).toEqual([]);
    expect(hasPendingViewerEdit(TAB)).toBe(true);
    act(() => fill(TAB, "T9"));
    expect(events).toEqual(["onUpdate"]);
    expect(hasPendingViewerEdit(TAB)).toBe(false);
    expect(
      useEditorStore.getState().sourceBufferAccess?.getSourceBuffer(TAB),
    ).toBe("T9");
    expect(count(events, "getText")).toBe(0);
  });
});

/** The host alone, with App's buffer hook, so a test can change only its `tabId`. */
function Direct({
  tabId,
  viewer,
}: {
  tabId: string;
  viewer: PluginFileViewer;
}) {
  const { getSourceBuffer, hasSourceBuffer } = useSourceMode({ editor: null });
  const edit = useMemo(
    () => ({ getSourceBuffer, hasSourceBuffer, rearmAutoSave: () => {} }),
    [getSourceBuffer, hasSourceBuffer],
  );
  return (
    <PluginViewerHost
      edit={edit}
      filePath={PATH}
      refreshKey={0}
      tabId={tabId}
      viewer={viewer}
    />
  );
}

describe("on the way down (§7)", () => {
  it("a tab switch takes the change, then onUnmount; coming back mounts the unsaved text (D3)", () => {
    const double = viewerDouble(events);
    open(double, [sketchTab(), sketchTab("t-note", "/v/n.txt")]);
    act(() => {
      fill(TAB, "T0");
      fill("t-note", "note");
    });
    act(() => draw(double, "T1"));
    events.length = 0;
    act(() => useEditorStore.setState({ activeTabId: "t-note" }));
    expect(count(events, "getText")).toBe(1);
    expect(events.indexOf("getText")).toBeLessThan(events.indexOf("onUnmount"));
    act(() => useEditorStore.setState({ activeTabId: TAB }));
    expect(lastEdit(double).text).toBe("T1");
  });

  it("an element reused for another tab: the old mount goes down, a new one comes up, and the old markChanged does nothing (D13)", () => {
    const double = viewerDouble(events);
    seedStores([sketchTab("a"), sketchTab("b")], "a");
    const view = render(<Direct tabId="a" viewer={double.viewer} />);
    act(() => {
      fill("a", "A0");
      fill("b", "B0");
    });
    const first = lastEdit(double);
    events.length = 0;
    view.rerender(<Direct tabId="b" viewer={double.viewer} />);
    expect(events).toEqual(["onUnmount", "onMount"]);
    expect(lastEdit(double)).toMatchObject({ tabId: "b", text: "B0" });
    act(() => first.markChanged());
    expect(useEditorStore.getState().tabs.map((t) => t.isDirty)).toEqual([
      false,
      false,
    ]);
    expect(hasPendingViewerEdit("a")).toBe(false);
    act(() => lastEdit(double).markChanged());
    expect(useEditorStore.getState().tabs[1].isDirty).toBe(true);
  });

  it("a tab closed without a read (Don't Save, dragged into a window) is not read: getText 0, no toast", () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const double = viewerDouble(events, {
      getText: () => {
        events.push("getText");
        throw new Error("would toast if it were read");
      },
    });
    open(double);
    act(() => fill(TAB, "T0"));
    act(() => draw(double, "T1"));
    events.length = 0;
    act(() => useEditorStore.getState().closeTab(TAB));
    expect(count(events, "getText")).toBe(0);
    expect(events).toContain("onUnmount");
    expect(useUIStore.getState().toast).toBeNull();
  });

  it("the same failing viewer IS read on a tab switch — and its failure toasts (the positive half)", () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const double = viewerDouble(events, {
      getText: () => {
        events.push("getText");
        throw new Error("boom");
      },
    });
    open(double, [sketchTab(), sketchTab("t-note", "/v/n.txt")]);
    act(() => {
      fill(TAB, "T0");
      fill("t-note", "note");
    });
    act(() => draw(double, "T1"));
    act(() => useEditorStore.setState({ activeTabId: "t-note" }));
    expect(count(events, "getText")).toBe(1);
    expect(useUIStore.getState().toast?.type).toBe("error");
  });

  it("under StrictMode's double mount, the first mount's markChanged does nothing (D13 · §13)", () => {
    const double = viewerDouble(events);
    seedStores([sketchTab()], null);
    usePluginUIStore.getState().registerFileViewer(double.viewer);
    render(
      <StrictMode>
        <ViewerEditHarness {...harnessProps(newProbe(events))} />
      </StrictMode>,
    );
    act(() => fill(TAB, "T0"));
    act(() => useEditorStore.setState({ activeTabId: TAB }));
    expect(events).toEqual(["onMount", "onUnmount", "onMount"]);
    const [first, second] = double.contexts.map((c) => c.edit);
    act(() => first?.markChanged());
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
    act(() => second?.markChanged());
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });

  it("an onMount that throws leaves an empty pane, and the source view shows the intact buffer (§7.5)", () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const double = viewerDouble(events, {
      onMount: () => {
        throw new Error("broken viewer");
      },
    });
    const probe = newProbe(events);
    seedStores([sketchTab()], TAB);
    usePluginUIStore.getState().registerFileViewer(double.viewer);
    const view = render(<ViewerEditHarness {...harnessProps(probe)} />);
    act(() => fill(TAB, "T0"));
    act(() => probe.toggle());
    expect(view.container.querySelector("pre.code-probe")?.textContent).toBe(
      "T0",
    );
  });
});
