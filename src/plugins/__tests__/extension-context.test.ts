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
    usePluginUIStore.setState({ statusBarItems: [] });
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
});
