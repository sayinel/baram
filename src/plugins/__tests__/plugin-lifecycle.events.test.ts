import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useContextStore } from "../../stores/context/context";
import { createExtensionContext } from "../extension-context";
import {
  locateInContext,
  notifyEditorReady,
  notifyFileOpen,
  notifyFileSave,
} from "../plugin-lifecycle";
import {
  resetSandboxEventBridge,
  setContextResolver,
  subscribeSandbox,
} from "../sandbox/sandbox-event-bridge";

// §260 Phase 4a — one app notification must reach BOTH tiers. They take different
// routes (a same-realm handler vs. a transport frame with a translated path), so the
// hazard is wiring a new event to one and forgetting the other; these tests pin that
// both arrive from a single `notify*` call.
describe("plugin event notification across tiers (§260 Phase 4a)", () => {
  beforeEach(() => resetSandboxEventBridge());
  afterEach(() => vi.restoreAllMocks());

  function sandbox(capabilities: string[]) {
    const delivered: Array<[string, unknown[]]> = [];
    subscribeSandbox({
      capabilities: capabilities as never,
      pluginId: "sandboxed",
      session: {
        deliverEvent: (event, args) => void delivered.push([event, args]),
      },
    });
    return delivered;
  }

  /** A trusted plugin listening through its ExtensionContext. */
  function trusted() {
    const heard: Array<[string, unknown[]]> = [];
    const ctx = createExtensionContext(
      {
        capabilities: ["events"],
        id: "trusted",
        name: "Trusted",
      } as never,
      "/p/trusted",
    );
    for (const event of ["editor:ready", "file:open", "file:save"]) {
      ctx.events.on(event, (...args) => void heard.push([event, args]));
    }
    return { ctx, heard };
  }

  it("delivers one notification to both tiers, absolute to trusted, relative to sandboxed", () => {
    setContextResolver((absolute) =>
      absolute.startsWith("/v/")
        ? { context: "ctx-1", path: absolute.slice(3) }
        : null,
    );
    const delivered = sandbox(["events"]);
    const { ctx, heard } = trusted();

    notifyEditorReady();
    notifyFileOpen("/v/notes/a.md");
    notifyFileSave("/v/notes/a.md");

    // The trusted tier keeps the absolute path it has always had — it runs in this
    // realm and can read any file anyway.
    expect(heard).toEqual([
      ["editor:ready", []],
      ["file:open", ["/v/notes/a.md"]],
      ["file:save", ["/v/notes/a.md"]],
    ]);
    // The sandboxed tier gets the translated form and never an absolute path.
    expect(delivered).toEqual([
      ["editor:ready", []],
      ["file:open", [{ context: "ctx-1", path: "notes/a.md" }]],
      ["file:save", [{ context: "ctx-1", path: "notes/a.md" }]],
    ]);

    for (const d of ctx.subscriptions) d.dispose();
  });

  describe("locateInContext — the translation installed at startup", () => {
    beforeEach(() => {
      useContextStore.setState({
        activeContextId: "ctx-a",
        contexts: [
          { contextType: "vault", id: "ctx-a", path: "/vaults/a" },
          // A nested vault: the app's longest-prefix rule (§81) decides, and whichever
          // context it picks is the one the plugin will be allowed to read against.
          { contextType: "vault", id: "ctx-b", path: "/vaults/a/nested" },
          { contextType: "file", id: "ctx-f", path: "/elsewhere/single.md" },
        ] as never,
      });
    });

    it("returns the containing context and a relative path", () => {
      expect(locateInContext("/vaults/a/notes/x.md")).toEqual({
        context: "ctx-a",
        path: "notes/x.md",
      });
    });

    it("prefers the innermost context, so the path is relative to the right root", () => {
      expect(locateInContext("/vaults/a/nested/deep/x.md")).toEqual({
        context: "ctx-b",
        path: "deep/x.md",
      });
    });

    it("gives a single-file context an empty path — the context IS the file", () => {
      // Rust accepts "" against a file context and refuses anything else, so this is the
      // only form that can round-trip back through `files.readFile`.
      expect(locateInContext("/elsewhere/single.md")).toEqual({
        context: "ctx-f",
        path: "",
      });
    });

    it("returns null for a file in no registered context", () => {
      expect(locateInContext("/tmp/scratch.md")).toBeNull();
    });

    it("never returns a path that could escape the root", () => {
      // Whatever the store says, the result is a plain relative path: no leading
      // separator (which Rust would read as absolute) and no traversal.
      for (const p of [
        "/vaults/a/notes/x.md",
        "/vaults/a/nested/deep/x.md",
        "/elsewhere/single.md",
      ]) {
        const located = locateInContext(p);
        expect(located).not.toBeNull();
        expect(located!.path.startsWith("/")).toBe(false);
        expect(located!.path.split("/")).not.toContain("..");
      }
    });
  });
});
