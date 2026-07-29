import type { PluginSettingField } from "../../types";
import type { SandboxContext } from "../../types";
import type { PluginOp } from "../plugin-op";
import type { HostToSandbox } from "../protocol";

import { describe, expect, it } from "vitest";

import { MAX_SETTING_VALUE_CHARS } from "../../plugin-settings";
import { createHostRequestHandler } from "../host-request-router";
import { SETTINGS_CHANGED_EVENT } from "../host-settings-bridge";
import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

// §260 Phase 4c — real client ↔ real session, with a fake Rust closing the staging round
// trip (the same shape as the 4b editor test). This is where the transport property is
// observable: a plugin's settings must never appear in a frame sent to the sandbox.
describe("settings end-to-end: real client ↔ real session (§260 Phase 4c)", () => {
  // Enough declared fields at the per-string cap to put the payload well over tauri's
  // 8 KiB channel-data threshold — the size that makes staging necessary rather than tidy.
  const DECLARED: PluginSettingField[] = Array.from({ length: 16 }, (_, i) => ({
    key: `k${i}`,
    label: `Field ${i}`,
    type: "string",
  }));
  const PERSISTED = Object.fromEntries(
    DECLARED.map((f, i) => [
      f.key,
      `v${i}-${"x".repeat(MAX_SETTING_VALUE_CHARS - 8)}`,
    ]),
  );

  async function pair(capabilities: string[]) {
    let slot: null | string = null;
    const pulls: string[] = [];
    const broker = async (op: PluginOp) => {
      if (op.kind === "source_read") return "// bundle";
      if (op.kind === "staged_read") {
        if (slot === null) throw new Error("nothing is staged for this plugin");
        const payload = slot;
        slot = null;
        pulls.push(payload);
        return payload;
      }
      return undefined;
    };

    const { host, sandbox } = createChannelPair();
    const framesToSandbox: HostToSandbox[] = [];
    const recordingHost = {
      ...host,
      send: (m: HostToSandbox) => {
        framesToSandbox.push(m);
        host.send(m);
      },
    };

    let ctx: SandboxContext | undefined;
    const changes: unknown[][] = [];
    startSandboxClient(
      sandbox,
      async () => ({
        activate: (c: SandboxContext) => {
          ctx = c;
          c.events.on(SETTINGS_CHANGED_EVENT, (...args) => changes.push(args));
        },
      }),
      broker,
    );
    const session = new SandboxSession(
      recordingHost,
      createHostRequestHandler({
        capabilities: capabilities as never,
        declaredSettings: DECLARED,
        declaredStatusBarIds: [],
        persisted: () => PERSISTED,
        pluginId: "p",
        stage: async (_pluginId, payload) => {
          slot = payload;
        },
      }),
    );
    await session.activate("p", { commands: [] });
    if (!ctx) throw new Error("activate did not run");
    return { changes, ctx, framesToSandbox, pulls, session };
  }

  it("delivers the values through the staged pull, never in a frame", async () => {
    const { ctx, framesToSandbox, pulls } = await pair(["settings"]);

    const values = await ctx.settings.getAll();

    expect(values).toEqual(PERSISTED);
    expect(pulls).toEqual([JSON.stringify(PERSISTED)]); // it came through the broker
    // THE property. A frame this size enters tauri's app-global channel-data queue, which
    // is ACL-exempt and keyed by a guessable sequential id, so another sandboxed plugin
    // could read it — and settings are where an API key or a personal path ends up.
    const wire = JSON.stringify(framesToSandbox);
    expect(wire).not.toContain("v0-");
    expect(wire.length).toBeLessThan(2_000);
  });

  it("notifies without a payload, and the re-read is what carries the new values", async () => {
    const { changes, ctx, framesToSandbox, session } = await pair(["settings"]);

    session.deliverEvent(SETTINGS_CHANGED_EVENT, []);
    await Promise.resolve();

    expect(changes).toEqual([[]]);
    // The notification frame itself says nothing about the values.
    const notification = framesToSandbox.find(
      (f) => f.type === "deliverEvent" && f.event === SETTINGS_CHANGED_EVENT,
    );
    expect(notification).toBeDefined();
    expect(JSON.stringify(notification)).not.toContain("v0-");
    // …and re-reading works from inside the handler's realm, which is the whole point of
    // the notification.
    expect(await ctx.settings.getAll()).toEqual(PERSISTED);
  });

  it("surfaces a capability denial to plugin code", async () => {
    const { ctx } = await pair(["storage"]);
    await expect(ctx.settings.getAll()).rejects.toThrow(
      /requires the "settings" capability/,
    );
  });
});
