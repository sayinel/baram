import type { PluginContributions } from "../../types";
import type { HostToSandbox, SandboxToHost } from "../protocol";
import type { SandboxTransport } from "../transport";

import { describe, expect, it, vi } from "vitest";

import { startSandboxClient } from "../sandbox-client";
import { SandboxHost } from "../sandbox-host";
import { createChannelPair } from "./channel-pair";

// same pattern as plugin-loader.test.ts — the global test-setup.ts mock for
// "@tauri-apps/api/core" only provides `invoke`; SandboxHost.start needs
// `convertFileSrc` too.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

const DECLARED: PluginContributions = {
  commands: [{ id: "ping", title: "Ping" }],
};

function fakeFactory(created: string[], closed: string[]) {
  return (
    label: string,
  ): {
    close: () => void;
    transport: SandboxTransport<SandboxToHost, HostToSandbox>;
  } => {
    created.push(label);
    const { host, sandbox } = createChannelPair();
    startSandboxClient(sandbox, async () => ({
      activate: (ctx) => ctx.commands.register("ping", () => "pong"),
    }));
    return { close: () => closed.push(label), transport: host };
  };
}

describe("SandboxHost (§260 lifecycle)", () => {
  it("start() creates one window per plugin, activates, returns a live session", async () => {
    const created: string[] = [];
    const host = new SandboxHost(fakeFactory(created, []));
    const session = await host.start(
      "alpha",
      "/p/alpha",
      "index.mjs",
      DECLARED,
    );
    expect(created).toEqual(["plugin-alpha"]);
    expect(session.contributions).toBe(DECLARED);
    await expect(session.invokeCommand("ping")).resolves.toBe("pong");
  });

  it("stop() disposes the session and closes the window", async () => {
    const closed: string[] = [];
    const host = new SandboxHost(fakeFactory([], closed));
    await host.start("beta", "/p/beta", "index.mjs", DECLARED);
    await host.stop("beta");
    expect(closed).toEqual(["plugin-beta"]);
  });

  it("start() cleans up (no zombie) when activation fails (I3)", async () => {
    const closed: string[] = [];
    const host = new SandboxHost((label) => {
      const { host: h, sandbox } = createChannelPair();
      sandbox.onMessage((m) => {
        if ((m as HostToSandbox).type === "activate")
          (sandbox as SandboxTransport<HostToSandbox, SandboxToHost>).send({
            type: "activateError",
            error: "fail",
          });
      });
      return { close: () => closed.push(label), transport: h };
    });
    await expect(
      host.start("gamma", "/p/gamma", "index.mjs", DECLARED),
    ).rejects.toThrow(/fail/);
    expect(closed).toEqual(["plugin-gamma"]); // window closed, entry removed
    // a fresh start must build a NEW window, proving the dead entry was deleted
    closed.length = 0;
    const created2: string[] = [];
    const host2 = new SandboxHost(fakeFactory(created2, []));
    await host2.start("gamma", "/p/gamma", "index.mjs", DECLARED);
    expect(created2).toEqual(["plugin-gamma"]);
  });
});
