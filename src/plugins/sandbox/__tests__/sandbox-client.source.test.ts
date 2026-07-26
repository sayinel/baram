// §260 Phase 3c-2b — the sandbox fetches its OWN bundle through the broker
// (`source_read`) and imports it from a blob URL, so the realm needs no `asset:`
// and therefore has no file-read capability. The activate frame carries no URL.
import type { PluginContributions } from "../../types";
import type { PluginOp } from "../plugin-op";

import { describe, expect, it, vi } from "vitest";

import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

const DECLARED: PluginContributions = {
  commands: [{ id: "ping", title: "Ping" }],
};

const SOURCE =
  "export const activate = (ctx) => ctx.commands.register('ping');";

describe("sandbox source loading (§260 3c-2b)", () => {
  it("asks the broker for its own source and imports what it gets back", async () => {
    const ops: PluginOp[] = [];
    const imported: string[] = [];
    const broker = vi.fn(async (op: PluginOp) => {
      ops.push(op);
      return op.kind === "source_read" ? SOURCE : undefined;
    });
    const { host, sandbox } = createChannelPair();
    startSandboxClient(
      sandbox,
      async (source) => {
        imported.push(source);
        return {
          activate: (ctx) => ctx.commands.register("ping", () => "pong"),
        };
      },
      broker,
    );
    const session = new SandboxSession(host);

    await session.activate("alpha", DECLARED);

    // The op carries no path — Rust resolves the caller's own directory.
    expect(ops).toEqual([{ kind: "source_read" }]);
    expect(imported).toEqual([SOURCE]);
    expect(session.registered).toEqual({ commands: ["ping"], events: [] });
    await expect(session.invokeCommand("ping")).resolves.toBe("pong");
  });

  it("reports activateError — not a hang — when the source read is refused", async () => {
    const { host, sandbox } = createChannelPair();
    startSandboxClient(
      sandbox,
      async () => ({}),
      async () => {
        throw new Error("this sandbox is not registered");
      },
    );
    const session = new SandboxSession(host);
    await expect(session.activate("alpha", DECLARED)).rejects.toThrow(
      /not registered/,
    );
  });

  it("refuses a source that is not a string, rather than importing it", async () => {
    // A broker result is `unknown`; a non-string means the contract broke, and
    // handing it to the importer would fail somewhere far less legible.
    const { host, sandbox } = createChannelPair();
    startSandboxClient(
      sandbox,
      async () => ({}),
      async () => 42,
    );
    const session = new SandboxSession(host);
    await expect(session.activate("alpha", DECLARED)).rejects.toThrow(
      /source/i,
    );
  });
});
