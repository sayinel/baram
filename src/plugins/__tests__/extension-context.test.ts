import type { PluginManifest } from "../types";

// §69 Plugin ExtensionContext capability gating tests
import { beforeEach, describe, expect, test } from "vitest";

import { useUIStore } from "../../stores/ui/ui";
import { createExtensionContext } from "../extension-context";
import { usePluginUIStore } from "../plugin-ui-store";

function makeManifest(capabilities: string[]): PluginManifest {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    description: "A test plugin",
    version: "1.0.0",
    author: "Test",
    license: "MIT",
    main: "index.mjs",
    engines: { baram: ">=0.2.0" },
    capabilities: capabilities as PluginManifest["capabilities"],
    trust: "sandboxed",
  };
}

describe("createExtensionContext", () => {
  test("returns context with pluginId and pluginPath", () => {
    const ctx = createExtensionContext(
      makeManifest(["commands"]),
      "/test/path",
    );
    expect(ctx.pluginId).toBe("test-plugin");
    expect(ctx.pluginPath).toBe("/test/path");
    expect(ctx.subscriptions).toBeInstanceOf(Array);
  });

  describe("commands capability", () => {
    test("commands API works when capability is declared", () => {
      const ctx = createExtensionContext(makeManifest(["commands"]), "/test");
      let called = false;
      ctx.commands.register("test", () => {
        called = true;
      });
      ctx.commands.execute("test-plugin.test");
      expect(called).toBe(true);
    });

    test("commands API throws when capability is not declared", () => {
      const ctx = createExtensionContext(makeManifest([]), "/test");
      expect(() => ctx.commands.register("test", () => {})).toThrow(/commands/);
    });

    test("register with paletteVisible exposes a palette command; dispose removes it", () => {
      usePluginUIStore.setState({ paletteCommands: [] });
      const ctx = createExtensionContext(makeManifest(["commands"]), "/p");
      const d = ctx.commands.register("hello", () => {}, {
        paletteVisible: true,
        title: "Say Hello",
      });
      const cmds = usePluginUIStore.getState().paletteCommands;
      expect(cmds).toHaveLength(1);
      expect(cmds[0]).toMatchObject({
        commandId: "test-plugin.hello",
        pluginId: "test-plugin",
        title: "Say Hello",
      });
      d.dispose();
      expect(usePluginUIStore.getState().paletteCommands).toHaveLength(0);
    });

    test("register without palette opts does NOT expose a palette command", () => {
      usePluginUIStore.setState({ paletteCommands: [] });
      const ctx = createExtensionContext(makeManifest(["commands"]), "/p");
      ctx.commands.register("silent", () => {});
      expect(usePluginUIStore.getState().paletteCommands).toHaveLength(0);
    });
  });

  describe("editor capability", () => {
    test("editor API available with 'editor' capability", () => {
      const ctx = createExtensionContext(makeManifest(["editor"]), "/test");
      // getContent should return empty string when no editor is set
      expect(ctx.editor.getContent()).toBe("");
    });

    test("editor API available with 'editor:readonly' capability", () => {
      const ctx = createExtensionContext(
        makeManifest(["editor:readonly"]),
        "/test",
      );
      expect(ctx.editor.getContent()).toBe("");
    });

    test("editor:readonly prevents setContent", () => {
      const ctx = createExtensionContext(
        makeManifest(["editor:readonly"]),
        "/test",
      );
      expect(() => ctx.editor.setContent("test")).toThrow(/readonly/);
    });

    test("editor:readonly prevents insertText", () => {
      const ctx = createExtensionContext(
        makeManifest(["editor:readonly"]),
        "/test",
      );
      expect(() => ctx.editor.insertText("test")).toThrow(/readonly/);
    });

    test("editor API throws when no editor capability", () => {
      const ctx = createExtensionContext(makeManifest([]), "/test");
      expect(() => ctx.editor.getContent()).toThrow(/editor/);
    });
  });

  describe("files capability", () => {
    test("files:readonly prevents writeFile", async () => {
      const ctx = createExtensionContext(
        makeManifest(["files:readonly"]),
        "/test",
      );
      await expect(ctx.files.writeFile("/test.md", "content")).rejects.toThrow(
        /readonly/,
      );
    });

    test("files API throws when no files capability", () => {
      const ctx = createExtensionContext(makeManifest([]), "/test");
      expect(() => ctx.files.readFile("/test.md")).toThrow(/files/);
    });
  });

  describe("events capability", () => {
    test("events API works when capability is declared", () => {
      const ctx = createExtensionContext(makeManifest(["events"]), "/test");
      let received = false;
      ctx.events.on("test-event", () => {
        received = true;
      });
      ctx.events.emit("test-event");
      expect(received).toBe(true);
    });

    test("events API throws when not declared", () => {
      const ctx = createExtensionContext(makeManifest([]), "/test");
      expect(() => ctx.events.on("test", () => {})).toThrow(/events/);
    });
  });

  describe("ui capability", () => {
    test("ui API available with 'sidebar' capability", () => {
      const ctx = createExtensionContext(makeManifest(["sidebar"]), "/test");
      // Should not throw
      ctx.ui.showNotification("test");
    });

    test("ui API available with 'statusbar' capability", () => {
      const ctx = createExtensionContext(makeManifest(["statusbar"]), "/test");
      const disposable = ctx.ui.showStatusBarItem("test");
      expect(disposable.dispose).toBeInstanceOf(Function);
    });

    test("ui API throws when no sidebar/statusbar capability", () => {
      const ctx = createExtensionContext(makeManifest([]), "/test");
      expect(() => ctx.ui.showNotification("test")).toThrow(/sidebar/);
    });
  });

  describe("disposables", () => {
    test("command registration creates disposable in subscriptions", () => {
      const ctx = createExtensionContext(makeManifest(["commands"]), "/test");
      expect(ctx.subscriptions.length).toBe(0);
      ctx.commands.register("test", () => {});
      expect(ctx.subscriptions.length).toBe(1);
    });

    test("event subscription creates disposable in subscriptions", () => {
      const ctx = createExtensionContext(makeManifest(["events"]), "/test");
      ctx.events.on("test", () => {});
      expect(ctx.subscriptions.length).toBe(1);
    });

    test("disposable.dispose() removes handler", async () => {
      const ctx = createExtensionContext(makeManifest(["commands"]), "/test");
      let callCount = 0;
      const disposable = ctx.commands.register("counter", () => {
        callCount++;
      });
      await ctx.commands.execute("test-plugin.counter");
      expect(callCount).toBe(1);

      disposable.dispose();
      await expect(ctx.commands.execute("test-plugin.counter")).rejects.toThrow(
        /not found/,
      );
    });
  });

  describe("denied proxy", () => {
    test("denied proxy ignores Symbol.toPrimitive", () => {
      const ctx = createExtensionContext(makeManifest([]), "/test");
      // Should not throw when JS engine checks Symbol properties
      expect(() => String(ctx.commands)).not.toThrow();
    });

    test("denied proxy ignores 'then' for Promise compatibility", () => {
      const ctx = createExtensionContext(makeManifest([]), "/test");
      // When `then` is accessed and returns undefined, it won't be treated as a thenable
      expect(
        (ctx.commands as unknown as Record<string, unknown>).then,
      ).toBeUndefined();
    });
  });
});

describe("ExtensionContext ui API", () => {
  beforeEach(() => {
    usePluginUIStore.setState({
      settingsTabs: [],
      sidebarPanels: [],
      statusBarItems: [],
    });
    useUIStore.setState({ toast: null });
    document.head
      .querySelectorAll("style[data-baram-plugin]")
      .forEach((n) => n.remove());
  });

  test("denies ui without sidebar/statusbar capability", () => {
    const ctx = createExtensionContext(makeManifest(["commands"]), "/p");
    expect(() => ctx.ui.showNotification("x")).toThrow(
      /statusbar|sidebar|capability/i,
    );
  });

  test("showNotification fires a toast with the type", () => {
    const ctx = createExtensionContext(makeManifest(["statusbar"]), "/p");
    ctx.ui.showNotification("hello", "warning");
    expect(useUIStore.getState().toast).toMatchObject({
      message: "hello",
      type: "warning",
    });
  });

  test("showStatusBarItem registers, updates via setText, and disposes", () => {
    const ctx = createExtensionContext(makeManifest(["statusbar"]), "/p");
    const handle = ctx.ui.showStatusBarItem("A", "left");
    expect(usePluginUIStore.getState().statusBarItems).toHaveLength(1);
    expect(usePluginUIStore.getState().statusBarItems[0]).toMatchObject({
      align: "left",
      text: "A",
    });
    handle.setText("B");
    expect(usePluginUIStore.getState().statusBarItems[0].text).toBe("B");
    handle.dispose();
    expect(usePluginUIStore.getState().statusBarItems).toHaveLength(0);
  });

  test("addStyle injects a tagged <style> and removes it on dispose", () => {
    const ctx = createExtensionContext(makeManifest(["statusbar"]), "/p");
    const d = ctx.ui.addStyle(".x{color:red}");
    const el = document.head.querySelector(
      'style[data-baram-plugin="test-plugin"]',
    );
    expect(el?.textContent).toBe(".x{color:red}");
    d.dispose();
    expect(
      document.head.querySelector('style[data-baram-plugin="test-plugin"]'),
    ).toBeNull();
  });

  test("ui object exists with only 'settings' capability", () => {
    const ctx = createExtensionContext(makeManifest(["settings"]), "/p");
    expect(() => ctx.ui.showNotification("x")).not.toThrow();
  });

  test("addSidebarPanel requires 'sidebar' capability", () => {
    const ctx = createExtensionContext(makeManifest(["settings"]), "/p");
    expect(() =>
      ctx.ui.addSidebarPanel({ id: "p", onMount: () => {}, title: "P" }),
    ).toThrow(/sidebar/i);
  });

  test("addSidebarPanel registers a namespaced panel and disposes it", () => {
    const ctx = createExtensionContext(makeManifest(["sidebar"]), "/p");
    const d = ctx.ui.addSidebarPanel({
      id: "notes",
      onMount: () => {},
      title: "Notes",
    });
    const panels = usePluginUIStore.getState().sidebarPanels;
    expect(panels).toHaveLength(1);
    expect(panels[0].panelId).toBe("test-plugin:notes");
    expect(panels[0].pluginId).toBe("test-plugin");
    d.dispose();
    expect(usePluginUIStore.getState().sidebarPanels).toHaveLength(0);
  });

  test("addSettingsTab requires 'settings' capability", () => {
    const ctx = createExtensionContext(makeManifest(["sidebar"]), "/p");
    expect(() =>
      ctx.ui.addSettingsTab({ id: "t", onMount: () => {}, title: "T" }),
    ).toThrow(/settings/i);
  });

  test("addSettingsTab registers a namespaced tab and disposes it", () => {
    const ctx = createExtensionContext(makeManifest(["settings"]), "/p");
    const d = ctx.ui.addSettingsTab({
      id: "cfg",
      onMount: () => {},
      title: "Cfg",
    });
    expect(usePluginUIStore.getState().settingsTabs[0].tabId).toBe(
      "test-plugin:cfg",
    );
    d.dispose();
    expect(usePluginUIStore.getState().settingsTabs).toHaveLength(0);
  });

  test("showStatusBarItem requires 'statusbar' capability", () => {
    const ctx = createExtensionContext(makeManifest(["sidebar"]), "/p");
    expect(() => ctx.ui.showStatusBarItem("x")).toThrow(/statusbar/i);
  });
});

// Phase D integration guard: proves the capability→API gate matrix across
// ai/network/storage, and that one capability does not unlock the others.
// This file has no vi.mock for llm/plugin-invoke — only `typeof`/`toThrow`
// assertions are used below, so no method is ever invoked (import-free).
describe("Phase D capability gate matrix", () => {
  test("no-cap context denies ai/network/storage (denied proxy throws)", () => {
    const ctx = createExtensionContext(makeManifest([]), "/p");
    expect(() => ctx.ai.complete).toThrow(/ai/i);
    expect(() => ctx.network.fetch).toThrow(/network/i);
    expect(() => ctx.storage.read).toThrow(/storage/i);
  });

  test("declared caps expose the real APIs (methods are functions)", () => {
    const ctx = createExtensionContext(
      makeManifest(["ai", "network", "storage"]),
      "/p",
    );
    expect(typeof ctx.ai.complete).toBe("function");
    expect(typeof ctx.ai.stream).toBe("function");
    expect(typeof ctx.ai.listModels).toBe("function");
    expect(typeof ctx.network.fetch).toBe("function");
    expect(typeof ctx.storage.read).toBe("function");
    expect(typeof ctx.storage.write).toBe("function");
    expect(typeof ctx.storage.list).toBe("function");
    expect(typeof ctx.storage.remove).toBe("function");
  });

  test("one cap does not unlock the others (ai only)", () => {
    const ctx = createExtensionContext(makeManifest(["ai"]), "/p");
    expect(typeof ctx.ai.complete).toBe("function");
    expect(() => ctx.network.fetch).toThrow(/network/i);
    expect(() => ctx.storage.read).toThrow(/storage/i);
  });

  test("one cap does not unlock the others (network only)", () => {
    const ctx = createExtensionContext(makeManifest(["network"]), "/p");
    expect(typeof ctx.network.fetch).toBe("function");
    expect(() => ctx.ai.complete).toThrow(/ai/i);
    expect(() => ctx.storage.read).toThrow(/storage/i);
  });

  test("one cap does not unlock the others (storage only)", () => {
    const ctx = createExtensionContext(makeManifest(["storage"]), "/p");
    expect(typeof ctx.storage.read).toBe("function");
    expect(() => ctx.ai.complete).toThrow(/ai/i);
    expect(() => ctx.network.fetch).toThrow(/network/i);
  });

  test("unrelated cap ('commands') does not unlock ai/network/storage", () => {
    const ctx = createExtensionContext(makeManifest(["commands"]), "/p");
    expect(() => ctx.ai.complete).toThrow(/ai/i);
    expect(() => ctx.network.fetch).toThrow(/network/i);
    expect(() => ctx.storage.read).toThrow(/storage/i);
  });
});
