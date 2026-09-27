// §385 spec 0061 §5 — rights begin at a user command and end at the first outside input.
import type { PluginManifest } from "../types";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createExtensionContext } from "../extension-context";
import {
  commandHandlers,
  commandOwners,
  executePluginCommand,
  registerHostCommandHandler,
} from "../plugin-host-registry";
import {
  beginPluginInvocation,
  clearPromptGate,
  markPromptClosed,
  markPromptOpen,
  promptRefusal,
  resetPromptGate,
  revokePromptRights,
} from "../prompt-gate";

const key = (k: string, target: EventTarget = document.body) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: k }));

afterEach(() => {
  resetPromptGate();
  commandHandlers.clear();
  commandOwners.clear();
});

describe("promptRefusal", () => {
  it("refuses with no invocation, allows during one, refuses after it ends", () => {
    expect(promptRefusal("p")).toMatch(/commands is running/);
    const end = beginPluginInvocation("p");
    expect(promptRefusal("p")).toBeNull();
    end();
    expect(promptRefusal("p")).toMatch(/commands is running/);
  });

  it("is ended by a key or a pointer press outside the prompt", () => {
    beginPluginInvocation("p");
    key("a");
    expect(promptRefusal("p")).toMatch(
      /typed, clicked or dropped something outside/,
    );
    beginPluginInvocation("q");
    document.body.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true }),
    );
    expect(promptRefusal("q")).toMatch(
      /typed, clicked or dropped something outside/,
    );
    // spec 0061 §5.2 — IME composition still fires keydown (keyCode 229) and counts as input.
    beginPluginInvocation("r");
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        isComposing: true,
        key: "Process",
        keyCode: 229,
      }),
    );
    expect(promptRefusal("r")).toMatch(
      /typed, clicked or dropped something outside/,
    );
  });

  it("is ended by text input or a drop that arrives with no key or click", () => {
    // spec 0061 D1, §5.2 — macOS dictation and the character viewer reach the page as
    // `beforeinput`, a drag-drop as `drop`; neither brings a `keydown` or `pointerdown`.
    beginPluginInvocation("p");
    expect(promptRefusal("p")).toBeNull(); // the rights the event below has to end
    document.body.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        data: "a",
        inputType: "insertText",
      }),
    );
    expect(promptRefusal("p")).toMatch(/dropped something outside/);
    beginPluginInvocation("q");
    expect(promptRefusal("q")).toBeNull();
    document.body.dispatchEvent(new Event("drop", { bubbles: true }));
    expect(promptRefusal("q")).toMatch(/dropped something outside/);
  });

  it("does not count a modifier alone, a keyup, or input inside the open prompt", () => {
    beginPluginInvocation("p");
    key("Shift");
    document.body.dispatchEvent(
      new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }),
    );
    const root = document.body.appendChild(document.createElement("div"));
    const inside = root.appendChild(document.createElement("input"));
    const prompt = { close: vi.fn(), pluginId: "other", root };
    markPromptOpen(prompt);
    key("Enter", inside);
    inside.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        data: "a",
        inputType: "insertText",
      }),
    );
    inside.dispatchEvent(new Event("drop", { bubbles: true }));
    markPromptClosed(prompt);
    root.remove();
    expect(promptRefusal("p")).toBeNull(); // positive twin: none of the above ended the rights
  });

  it("counts a drop ON the open prompt's root — the backdrop — but not one on a child inside it", () => {
    // The overlay element itself is the backdrop around the dialog, outside the prompt; only
    // its descendants are the prompt's own. Checked while the prompt is open, so the refusal
    // shows which condition stopped it: condition 2 (outside input) or condition 3 (a prompt
    // is open), which is reached only when condition 2 passed.
    const root = document.body.appendChild(document.createElement("div"));
    const inside = root.appendChild(document.createElement("div"));
    const prompt = { close: vi.fn(), pluginId: "other", root };
    beginPluginInvocation("p");
    markPromptOpen(prompt);
    inside.dispatchEvent(new Event("drop", { bubbles: true }));
    expect(promptRefusal("p")).toMatch(/already open/); // the child drop left rights intact
    root.dispatchEvent(new Event("drop", { bubbles: true }));
    expect(promptRefusal("p")).toMatch(/dropped something outside/);
    markPromptClosed(prompt);
    root.remove();
  });

  it("counts the launching key BEFORE the invocation starts — capture phase on window", () => {
    // A bubble handler below window starts the invocation, as React's root listener does for
    // the palette's Enter. The request is checked AFTER dispatch, as an awaited one is. With the
    // watcher in bubble phase it would count this key after the start and revoke at once.
    const launcher = document.body.appendChild(document.createElement("div"));
    launcher.addEventListener("keydown", () => void beginPluginInvocation("p"));
    key("Enter", launcher);
    launcher.remove();
    expect(promptRefusal("p")).toBeNull();
  });

  it("is revoked by a cancel and restored by the next invocation", () => {
    beginPluginInvocation("p");
    revokePromptRights("p");
    expect(promptRefusal("p")).toMatch(/cancelled or covered/);
    beginPluginInvocation("p");
    expect(promptRefusal("p")).toBeNull();
  });

  it("refuses while any prompt is open, and while focus is inside a frame", () => {
    beginPluginInvocation("p");
    const prompt = {
      close: vi.fn(),
      pluginId: "q",
      root: document.createElement("div"),
    };
    markPromptOpen(prompt);
    expect(promptRefusal("p")).toMatch(/already open/);
    markPromptClosed(prompt);
    const frame = document.body.appendChild(document.createElement("iframe"));
    frame.tabIndex = 0;
    frame.focus();
    expect(document.activeElement).toBe(frame);
    expect(promptRefusal("p")).toMatch(/inside a frame/);
    frame.remove();
    expect(promptRefusal("p")).toBeNull();
  });

  it("sees a frame focused inside an open shadow root, behind its host", () => {
    // A trusted plugin panel mounts inside an open shadow root (`PluginShadowMount.tsx`), so
    // focusing an iframe there reports the shadow HOST as `document.activeElement`, not the
    // iframe itself — condition 4 has to look through it (`deep-active-element.ts`).
    beginPluginInvocation("p");
    const host = document.body.appendChild(document.createElement("div"));
    const shadow = host.attachShadow({ mode: "open" });
    const frame = shadow.appendChild(document.createElement("iframe"));
    frame.tabIndex = 0;
    frame.focus();
    expect(document.activeElement).toBe(host); // proves the premise
    expect(promptRefusal("p")).toMatch(/inside a frame/);
    host.remove();
  });
});

describe("clearPromptGate", () => {
  it("closes that plugin's open prompt and forgets its rights", () => {
    beginPluginInvocation("p");
    const prompt = {
      close: vi.fn(),
      pluginId: "p",
      root: document.createElement("div"),
    };
    markPromptOpen(prompt);
    clearPromptGate("p");
    expect(prompt.close).toHaveBeenCalledOnce();
    expect(promptRefusal("p")).toMatch(/commands is running/);
  });

  it("leaves a new invocation alone when an old one ends late", () => {
    const oldEnd = beginPluginInvocation("p");
    clearPromptGate("p");
    beginPluginInvocation("p");
    oldEnd(); // the old handler's finally, after a reload
    expect(promptRefusal("p")).toBeNull();
  });

  it("drops rights before a throwing close runs, not after", () => {
    beginPluginInvocation("p");
    const prompt = {
      close: vi.fn(() => {
        throw new Error("teardown boom");
      }),
      pluginId: "p",
      root: document.createElement("div"),
    };
    markPromptOpen(prompt);
    expect(() => clearPromptGate("p")).toThrow("teardown boom");
    expect(promptRefusal("p")).toMatch(/commands is running/);
  });

  it("leaves another plugin's open prompt alone", () => {
    beginPluginInvocation("p");
    const prompt = {
      close: vi.fn(),
      pluginId: "p",
      root: document.createElement("div"),
    };
    markPromptOpen(prompt);
    clearPromptGate("q");
    expect(prompt.close).not.toHaveBeenCalled();
  });
});

describe("executePluginCommand", () => {
  it("gives the owner rights while its handler runs, and takes them when it settles", async () => {
    let during: null | string = "unset";
    registerHostCommandHandler(
      "p.go",
      () => {
        during = promptRefusal("p");
      },
      "p",
    );
    await executePluginCommand("p.go");
    expect(during).toBeNull();
    expect(promptRefusal("p")).toMatch(/commands is running/);
  });

  it("takes the rights back when the handler rejects", async () => {
    registerHostCommandHandler(
      "p.bad",
      async () => {
        throw new Error("boom");
      },
      "p",
    );
    await expect(executePluginCommand("p.bad")).rejects.toThrow("boom");
    expect(promptRefusal("p")).toMatch(/commands is running/);
  });

  it("holds rights for as long as the handler's promise is pending — `return await`", async () => {
    let release: (() => void) | undefined;
    registerHostCommandHandler(
      "p.slow",
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
      "p",
    );
    const run = executePluginCommand("p.slow");
    await Promise.resolve();
    expect(promptRefusal("p")).toBeNull();
    release?.();
    await run;
    expect(promptRefusal("p")).toMatch(/commands is running/);
  });
});

describe("commands.execute", () => {
  // spec 0061 §5.1 — a plugin running a command itself (from its own panel, or from another
  // command) is no user gesture: only `executePluginCommand` starts an invocation. This fails if
  // `commands.execute` is routed through `executePluginCommand`, or if the rights are hung on
  // every `commandHandlers` call instead.
  const manifest = {
    author: "t",
    capabilities: ["commands"],
    description: "t",
    engines: { baram: ">=0.2.0" },
    id: "p",
    license: "MIT",
    main: "index.mjs",
    name: "P",
    trust: "trusted",
    version: "1.0.0",
  } as unknown as PluginManifest;

  it("grants nothing, where the same handler run by executePluginCommand has rights", async () => {
    const ctx = createExtensionContext(manifest, "/p");
    const seen: (null | string)[] = [];
    ctx.commands.register("go", () => {
      seen.push(promptRefusal("p"));
    });
    await ctx.commands.execute("go");
    await executePluginCommand("p.go");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatch(/commands is running/);
    expect(seen[1]).toBeNull(); // positive twin: the handler can see rights when they exist
  });
});
