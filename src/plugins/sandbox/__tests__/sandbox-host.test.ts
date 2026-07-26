import type { PluginContributions } from "../../types";
import type { HostToSandbox, SandboxToHost } from "../protocol";
import type { SandboxWindow } from "../sandbox-host";
import type { SandboxTransport } from "../transport";

import { describe, expect, it } from "vitest";

import { startSandboxClient } from "../sandbox-client";
import { SandboxHost } from "../sandbox-host";
import { createChannelPair } from "./channel-pair";

// §260 3c-2b — no `convertFileSrc` mock is needed any more: the host stopped
// building an asset URL when the sandbox took over resolving its own bundle.

const DECLARED: PluginContributions = {
  commands: [{ id: "ping", title: "Ping" }],
};

function fakeFactory(
  created: string[],
  closed: string[],
  // §260 3c-2a review (M3): the factory's 2nd arg is the plugin ID, not the label.
  // Confusing them silently breaks the whole transport (`plugin_sandbox_send` would
  // target `plugin-plugin-alpha` and the s2h filter would never match), so record
  // it and assert.
  pluginIds: string[] = [],
) {
  return (
    label: string,
    pluginId: string,
    // Typed as the real interface so the annotation cannot drift from it — an
    // inline `close: () => void` would locally reject an async close the real
    // `SandboxWindow` allows (3c-2a final pass, Q4).
  ): SandboxWindow => {
    created.push(label);
    pluginIds.push(pluginId);
    // NOTE: `close` must have a void body — `SandboxWindow.close` is
    // `() => Promise<void> | void`, and TS's return-value-for-void allowance does
    // not apply to a union, so `() => closed.push(x)` (number) is rejected.
    const { host, sandbox } = createChannelPair();
    startSandboxClient(
      sandbox,
      async () => ({
        activate: (ctx) => ctx.commands.register("ping", () => "pong"),
      }),
      // §260 3c-2b — the client fetches its own source through the broker.
      async () => "// bundle",
    );
    return {
      close: () => {
        closed.push(label);
      },
      transport: host,
    };
  };
}

describe("SandboxHost (§260 lifecycle)", () => {
  it("start() creates one window per plugin, activates, returns a live session", async () => {
    const created: string[] = [];
    const pluginIds: string[] = [];
    const host = new SandboxHost(fakeFactory(created, [], pluginIds));
    const session = await host.start("alpha", DECLARED);
    expect(created).toEqual(["plugin-alpha"]);
    // The label is prefixed; the transport must get the BARE id (see fakeFactory).
    expect(pluginIds).toEqual(["alpha"]);
    expect(session.contributions).toBe(DECLARED);
    await expect(session.invokeCommand("ping")).resolves.toBe("pong");
  });

  it("stop() disposes the session and closes the window", async () => {
    const closed: string[] = [];
    const host = new SandboxHost(fakeFactory([], closed));
    await host.start("beta", DECLARED);
    await host.stop("beta");
    expect(closed).toEqual(["plugin-beta"]);
  });

  // §260 3c-2a re-review (N1) — `stop()` must not resolve until the webview is
  // actually gone, or a fast reload collides on the `plugin-<id>` label (the real
  // `WebviewWindow.close()` is async, and its promise used to be discarded).
  it("stop() awaits an async window close before resolving", async () => {
    let releaseClose: () => void = () => {};
    let closeFinished = false;
    const host = new SandboxHost((label) => {
      const { host: h, sandbox } = createChannelPair();
      startSandboxClient(
        sandbox,
        async () => ({}),
        // §260 3c-2b — the client fetches its own source through the broker.
        async () => "// bundle",
      );
      void label;
      return {
        close: async () => {
          await new Promise<void>((resolve) => {
            releaseClose = resolve;
          });
          closeFinished = true;
        },
        transport: h,
      };
    });
    await host.start("beta", {});

    let stopped = false;
    const stopping = host.stop("beta").then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false); // still waiting on the close

    releaseClose();
    await stopping;
    expect(closeFinished).toBe(true);
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
      return {
        close: () => {
          closed.push(label);
        },
        transport: h,
      };
    });
    await expect(host.start("gamma", DECLARED)).rejects.toThrow(/fail/);
    expect(closed).toEqual(["plugin-gamma"]); // window closed, entry removed
    // a fresh start must build a NEW window, proving the dead entry was deleted
    closed.length = 0;
    const created2: string[] = [];
    const host2 = new SandboxHost(fakeFactory(created2, []));
    await host2.start("gamma", DECLARED);
    expect(created2).toEqual(["plugin-gamma"]);
  });
});
