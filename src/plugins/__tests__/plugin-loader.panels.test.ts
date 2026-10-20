// §394 spec 0073 D14 · plan 0126 P9 · P14 · P22 — a sandboxed load puts its declared panels up before the
// sandbox starts, hands the session a handler that keeps their content, and takes them down on a failed
// load, on unload and on a Reload.
import { createElement } from "react";

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The register/deregister IPC and staging, stubbed as `plugin-loader.sandbox.test.ts` does.
// `pluginNoteLink` too: the panels' click module imports it (Task 5), and a factory that leaves an
// export out throws when it is read.
const pluginSandboxRegister = vi.fn(async (..._a: unknown[]) => {});
const pluginSandboxDeregister = vi.fn(async (..._a: unknown[]) => {});
const pluginSandboxStage = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginNoteLink: vi.fn(),
  pluginSandboxDeregister: (...a: unknown[]) => pluginSandboxDeregister(...a),
  pluginSandboxRegister: (...a: unknown[]) => pluginSandboxRegister(...a),
  pluginSandboxStage: (...a: unknown[]) => pluginSandboxStage(...a),
}));

import type { PluginManifest } from "../types";

import { PluginPanelHost } from "../../components/layout/PluginPanelHost";
import { logger } from "../../utils/logger";
import { validateManifest } from "../manifest";
import { PluginLoader } from "../plugin-loader";
import { usePluginUIStore } from "../plugin-ui-store";
import {
  __resetPanelContents,
  panelContent,
  setPanelContent,
} from "../rendered/panel-contents";
import { registerDeclaredPanels } from "../rendered/panels-host";
import { resetSandboxEventBridge } from "../sandbox/sandbox-event-bridge";
import { SandboxHost } from "../sandbox/sandbox-host";

type Handler = (
  request: unknown,
  onToken?: (token: string) => void,
) => Promise<unknown>;

/** A fake SandboxHost: no webview, a session with the members the loader reaches. */
function fakeHost() {
  const invokeAction = vi.fn(async (..._a: unknown[]) => {});
  const stop = vi.fn(async () => {});
  const start = vi.fn(
    async (
      _id: string,
      declared: unknown,
      _handler?: Handler,
      _codeBlockLangs?: unknown,
      _panelIds?: unknown,
    ) => ({
      contributions: declared,
      deliverEvent: vi.fn(),
      invokeAction,
      invokeCommand: vi.fn(async () => "ok"),
    }),
  );
  return {
    host: { start, stop } as unknown as SandboxHost,
    invokeAction,
    start,
    stop,
  };
}

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    author: "t",
    capabilities: ["sidebar"],
    contributions: {
      panels: [
        { icon: "🧪", id: "live", title: "Li\u202eve\nnow" },
        { icon: "\u202e", id: "bare", title: "Bare" },
      ],
    },
    description: "t",
    engines: { baram: ">=0.2.0" },
    id: "demo",
    license: "MIT",
    main: "index.mjs",
    name: "Demo",
    trust: "sandboxed",
    version: "1.0.0",
    ...overrides,
  };
}

/** The two panels as the store holds them: text sanitized, the bidi-only icon gone (P22). */
const REGISTERED = [
  {
    icon: "🧪",
    kind: "rendered",
    panelId: "demo:live",
    pluginId: "demo",
    sourceName: "Demo",
    title: "Live now",
  },
  {
    kind: "rendered",
    panelId: "demo:bare",
    pluginId: "demo",
    sourceName: "Demo",
    title: "Bare",
  },
];

/** The text drawn in the plugin seat's panel body — what the view's painter last drew. */
const drawnIn = (host: Element | null) => host?.shadowRoot?.textContent ?? "";

beforeEach(() => {
  pluginSandboxRegister.mockReset().mockImplementation(async () => {});
  pluginSandboxDeregister.mockReset().mockImplementation(async () => {});
  __resetPanelContents();
  usePluginUIStore.setState({
    activePluginPanelId: null,
    paletteCommands: [],
    sidebarPanels: [],
    statusBarItems: [],
  });
  resetSandboxEventBridge();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a sandboxed load's declared panels", () => {
  /** P9 · P22 — up before the sandbox starts, open for content, their text sanitized and attributed
   *  as the activity bar draws it. What fails this: registering after `start` (nothing at the start),
   *  not opening them (the write is refused), or the manifest's text as written (a bidi override and a
   *  line break in the title). */
  it("are up and open before the sandbox starts, sanitized and attributed", async () => {
    const f = fakeHost();
    let atStart: unknown[] = [];
    let openAtStart = false;
    f.start.mockImplementation(async (_id, declared) => {
      atStart = usePluginUIStore.getState().sidebarPanels;
      openAtStart = setPanelContent("demo:live", { html: "" });
      return {
        contributions: declared,
        deliverEvent: vi.fn(),
        invokeAction: f.invokeAction,
        invokeCommand: vi.fn(async () => "ok"),
      };
    });
    await new PluginLoader(undefined, f.host).loadPlugin("/p/demo", manifest());
    expect(atStart).toEqual(REGISTERED);
    expect(openAtStart).toBe(true);
  });

  /** P22 · Task 1 review — an icon the manifest accepts as one character but that draws nothing once
   *  sanitized is left out, so the activity bar draws its `Blocks` icon in its place: a lone space or
   *  line break (the sanitizer removes them), and a lone ZWJ, U+FE0F or U+3164 HANGUL FILLER (it keeps
   *  them; they are default-ignorable). The pairs: each manifest is valid, so the icon does reach
   *  registration, and icons that draw — a flag, a ZWJ family emoji, a Hangul syllable — are kept as
   *  they are. What fails this: storing the sanitized icon when it is empty (`icon: ""`) or invisible,
   *  or leaving out an icon that holds a default-ignorable code point beside a visible one. */
  it("leave out an icon that draws nothing", () => {
    /** The icon stored for a lone panel declaring `icon` — `null` when it is left out. */
    const storedIcon = (icon: string) => {
      const one = manifest({
        contributions: { panels: [{ icon, id: "p", title: "P" }] },
      });
      expect(validateManifest(one).valid).toBe(true);
      usePluginUIStore.setState({ sidebarPanels: [] });
      registerDeclaredPanels(one, []);
      const [panel] = usePluginUIStore.getState().sidebarPanels;
      expect(panel.panelId).toBe("demo:p");
      return Object.hasOwn(panel, "icon") ? panel.icon : null;
    };
    const blank = [" ", "\n", "\u200d", "\ufe0f", "\u3164"];
    expect(blank.map(storedIcon)).toEqual(blank.map(() => null));
    const drawn = ["🇰🇷", "\u{1F468}\u200d\u{1F469}\u200d\u{1F467}", "가"];
    expect(drawn.map(storedIcon)).toEqual(drawn);
  });

  /** P8 — the session's handler keeps a declared panel's content and refuses another id, by the
   *  manifest's panels. What fails this: the loader not passing `declaredPanelIds` (every panel is then
   *  refused — the default is none, P27). */
  it("are written through the handler the session gets", async () => {
    const f = fakeHost();
    await new PluginLoader(undefined, f.host).loadPlugin("/p/demo", manifest());
    const handler = f.start.mock.calls[0][2]!;
    await handler({ html: "<p>x</p>", id: "live", kind: "ui_set_panel" });
    expect(panelContent("demo:live")?.content.html).toBe("<p>x</p>");
    await expect(
      handler({ html: "", id: "nope", kind: "ui_set_panel" }),
    ).rejects.toThrow(
      'ui.setPanel: panel "nope" is not declared in contributions.panels',
    );
  });

  /** P9 — a consent that narrowed `sidebar` away registers nothing, with a warning, as the status bar
   *  does without `statusbar`. (A manifest cannot declare panels without `sidebar` — validation refuses
   *  it — so this is the narrowed-consent case, called directly.) */
  it("are skipped, with a warning, without sidebar", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    registerDeclaredPanels(manifest({ capabilities: [] }), []);
    expect(usePluginUIStore.getState().sidebarPanels).toEqual([]);
    expect(setPanelContent("demo:live", { html: "" })).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/declares panels without the "sidebar" capability/),
    );
  });

  /** P14 — a failed load takes them down: the rollback disposes what landed and releases. What fails
   *  this: a rollback that leaves the panels up — and only when both the disposable's `closePanel` and
   *  `unregisterPluginUI`'s `releasePanels` are gone, since each closes them (Step 4 ③). The pair: the
   *  first row shows them up before the start, so the empty list here is the rollback's doing. */
  it("go when the load fails", async () => {
    const f = fakeHost();
    f.start.mockRejectedValue(new Error("webview creation failed"));
    await expect(
      new PluginLoader(undefined, f.host).loadPlugin("/p/demo", manifest()),
    ).rejects.toThrow("webview creation failed");
    expect(usePluginUIStore.getState().sidebarPanels).toEqual([]);
    expect(setPanelContent("demo:live", { html: "" })).toBe(false);
  });

  /** P14 — an unload takes the panels and their content; a dev folder Reload brings the panels back
   *  empty. What fails this: content that outlives the unload (the reloaded panel would show the old
   *  plugin's last content before the new one sends any). */
  it("go on unload, and come back empty on a Reload", async () => {
    const f = fakeHost();
    const loader = new PluginLoader(undefined, f.host);
    await loader.loadPlugin("/p/demo", manifest());
    setPanelContent("demo:live", { html: "<p>old</p>" });
    await loader.reloadPlugin("/p/demo", manifest());
    expect(usePluginUIStore.getState().sidebarPanels).toEqual(REGISTERED);
    expect(panelContent("demo:live")).toBeNull();
    await loader.unloadPlugin("demo");
    expect(usePluginUIStore.getState().sidebarPanels).toEqual([]);
    expect(setPanelContent("demo:live", { html: "" })).toBe(false);
  });

  /** P14 · P23 — the unload closes the panels before it stops the session: `unloadPlugin` runs the
   *  load's disposables, then the teardown, and `unregisterPluginUI` only after it. The fake `stop`
   *  sends one more write, as a session still running would. What fails this: a disposable that only
   *  takes the button down — the panel then stays open until the release after the stop (Step 4 ③,
   *  which the failed-load row cannot see: the rollback releases before its stop too). */
  it("are closed before the unload stops the session", async () => {
    const f = fakeHost();
    const loader = new PluginLoader(undefined, f.host);
    await loader.loadPlugin("/p/demo", manifest());
    const handler = f.start.mock.calls[0][2]!;
    let duringStop: unknown = "not sent";
    f.stop.mockImplementation(async () => {
      duringStop = await handler({
        html: "<p>late</p>",
        id: "live",
        kind: "ui_set_panel",
      }).then(
        () => "kept",
        (err: unknown) => err,
      );
    });
    await loader.unloadPlugin("demo");
    expect(duringStop).toEqual(
      new Error('ui.setPanel: panel "live" is not open'),
    );
    expect(panelContent("demo:live")).toBeNull();
  });

  /** Task 4 review — a Reload closes and reopens every panel, and `openPanel` starts the reopened
   *  entry's count over, while a view's painter holds the entry it subscribed to and the count it drew:
   *  a view still mounted when its panel is reopened would hear nothing and, the count at 1 again, draw
   *  nothing. None is. The unload takes the panel off the list (the disposable's `removeSidebarPanel`,
   *  then `unregisterPlugin`'s sweep) and clears the plugin seat (`activePluginPanelId`), and React
   *  renders the empty seat — unmounting the view — before the new load reopens the panel, since the
   *  Reload awaits the teardown in between. So the panel is drawn again only by a new view, once the
   *  user picks it. What fails this: a Reload after which the old view is still the seat's — measured:
   *  the panel kept on the list (both of its removals gone) and the seat kept, together; any one of the
   *  three gone alone keeps this green. */
  it("are drawn by a new view after a Reload", async () => {
    const f = fakeHost();
    const loader = new PluginLoader(undefined, f.host);
    await act(() => loader.loadPlugin("/p/demo", manifest()));
    act(() => usePluginUIStore.getState().setActivePluginPanelId("demo:live"));
    const { container } = render(createElement(PluginPanelHost));
    await act(() =>
      f.start.mock.calls[0][2]!({
        html: "<p>old</p>",
        id: "live",
        kind: "ui_set_panel",
      }),
    );
    const before = container.querySelector(".plugin-block-host");
    expect(drawnIn(before)).toBe("old");

    // Whether the old view is still mounted at the moment the reloaded panel is registered — just
    // after `registerDeclaredPanels` reopened it.
    const first = usePluginUIStore
      .getState()
      .sidebarPanels.find((p) => p.panelId === "demo:live");
    let mountedAtReopen: boolean | undefined;
    const unsubscribe = usePluginUIStore.subscribe((s) => {
      const reopened = s.sidebarPanels.some(
        (p) => p.panelId === "demo:live" && p !== first,
      );
      if (reopened && mountedAtReopen === undefined) {
        mountedAtReopen = before?.isConnected;
      }
    });
    await act(() => loader.reloadPlugin("/p/demo", manifest()));
    unsubscribe();
    expect(mountedAtReopen).toBe(false);
    expect(before?.isConnected).toBe(false);

    act(() => usePluginUIStore.getState().setActivePluginPanelId("demo:live"));
    await act(() =>
      f.start.mock.calls[1][2]!({
        html: "<p>new</p>",
        id: "live",
        kind: "ui_set_panel",
      }),
    );
    const after = container.querySelector(".plugin-block-host");
    expect(after).not.toBe(before);
    expect(drawnIn(after)).toBe("new");
  });
});
