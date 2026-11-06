// §260 — the real window factory, which every other SandboxHost test replaces with a fake. What it
// passes to `WebviewWindow` decides how the engine schedules a plugin's page, and no fake can see that.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { startSandboxClient } from "../sandbox-client";
import { SandboxHost } from "../sandbox-host";
import { createChannelPair } from "./channel-pair";

const created = vi.hoisted(
  () => [] as { label: string; options: Record<string, unknown> }[],
);

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    constructor(label: string, options: Record<string, unknown>) {
      created.push({ label, options });
    }
    static getByLabel = async () => null;
    close = async () => undefined;
    once = async (event: string, handler: () => void) => {
      if (event === "tauri://created") handler();
      return () => undefined;
    };
  },
}));

vi.mock("../tauri-host-transport", () => ({
  createHostTransport: async () => {
    const { host, sandbox } = createChannelPair();
    startSandboxClient(
      sandbox,
      async () => ({ activate: () => undefined }),
      async () => "// bundle",
    );
    return host;
  },
}));

describe("SandboxHost — the plugin window it creates (§260)", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("asks the engine to throttle the hidden page rather than suspend it", async () => {
    await new SandboxHost().start("alpha", {});

    expect(created).toHaveLength(1);
    expect(created[0].label).toBe("plugin-alpha");
    // This pins what is asked, not what the engine does: that was measured in the app, on macOS. There the
    // default stopped the whole page within seconds, and "disabled" kept a spinning plugin at the main
    // page's priority. Removing or changing the value fails this row.
    expect(created[0].options.backgroundThrottling).toBe("throttle");
  });

  it("still hides the window and never takes focus", async () => {
    await new SandboxHost().start("alpha", {});

    expect(created[0].options).toMatchObject({
      decorations: false,
      focus: false,
      skipTaskbar: true,
      visible: false,
    });
  });
});
