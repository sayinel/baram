// §260 Phase 3c-2a — the host end of the sandbox transport. Sends over the
// host-only `plugin_sandbox_send` command; receives the `plugin:s2h` event Rust
// re-emits, filtered to THIS plugin's id.
import type { PluginContributions } from "../../types";
import type { SandboxToHost } from "../protocol";

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const listen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listen(...args),
}));

import { SandboxSession } from "../sandbox-session";
import { createHostTransport } from "../tauri-host-transport";

const DECLARED: PluginContributions = {
  commands: [{ id: "ping", title: "Ping" }],
};

let deliver: (payload: unknown) => void;
let unlisten: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  // The real unlisten is async (it invokes `plugin:event|unlisten`), so the mock
  // must be too — otherwise a missing `.catch()` in close() would go unnoticed.
  unlisten = vi.fn().mockResolvedValue(undefined);
  listen
    .mockReset()
    .mockImplementation(
      async (_event: string, handler: (e: { payload: unknown }) => void) => {
        deliver = (payload) => handler({ payload });
        return unlisten;
      },
    );
});

describe("createHostTransport (§260 host end)", () => {
  it("sends through the host-only plugin_sandbox_send command", async () => {
    const transport = await createHostTransport("alpha");
    transport.send({ type: "deactivate" });
    expect(invoke).toHaveBeenCalledWith("plugin_sandbox_send", {
      pluginId: "alpha",
      msg: { type: "deactivate" },
    });
  });

  it("delivers only s2h messages stamped with this plugin's id", async () => {
    const transport = await createHostTransport("alpha");
    const seen: SandboxToHost[] = [];
    transport.onMessage((m) => seen.push(m));

    deliver({ pluginId: "beta", msg: { type: "activateError", error: "no" } });
    expect(seen).toEqual([]); // another plugin's report must not leak in

    deliver({
      pluginId: "alpha",
      msg: { type: "ready", registered: { commands: [], events: [] } },
    });
    expect(seen).toEqual([
      { type: "ready", registered: { commands: [], events: [] } },
    ]);
  });

  it("ignores malformed payloads instead of throwing into the listener", async () => {
    const transport = await createHostTransport("alpha");
    const seen: SandboxToHost[] = [];
    transport.onMessage((m) => seen.push(m));
    expect(() => deliver(null)).not.toThrow();
    expect(() => deliver({ pluginId: "alpha" })).not.toThrow();
    expect(() => deliver("nonsense")).not.toThrow();
    expect(seen).toEqual([]);
  });

  // `msg` is attacker-controlled (Rust forwards an unvalidated Value), so a frame
  // with a valid discriminant but a broken payload must not reach the session —
  // `{type:"ready",registered:null}` would throw on `report.commands`.
  it("drops frames whose inner shape does not match their discriminant", async () => {
    const transport = await createHostTransport("alpha");
    const seen: SandboxToHost[] = [];
    transport.onMessage((m) => seen.push(m));

    for (const msg of [
      { type: "ready", registered: null },
      { type: "ready", registered: { commands: "nope", events: [] } },
      { type: "ready" },
      { type: "callResult", ok: true }, // no callId
      { type: "callResult", callId: "c1", ok: false }, // no error string
      { type: "emitEvent", event: "e" }, // no args array
      { type: "activateError" }, // no error string
      { type: "somethingElse" },
    ]) {
      expect(() => deliver({ pluginId: "alpha", msg })).not.toThrow();
    }
    expect(seen).toEqual([]);

    // …and a well-formed frame of each kind still gets through.
    deliver({
      pluginId: "alpha",
      msg: { type: "ready", registered: { commands: [], events: [] } },
    });
    deliver({
      pluginId: "alpha",
      msg: { type: "callResult", callId: "c1", ok: true, value: 1 },
    });
    // A handler that returns nothing produces `value: undefined`, which JSON drops —
    // so the frame legitimately arrives with no `value` key at all. Pinned so a
    // future tightening to `"value" in m` fails loudly instead of silently dropping
    // every void command result (3c-2a re-review N7).
    deliver({
      pluginId: "alpha",
      msg: { type: "callResult", callId: "c2", ok: true },
    });
    deliver({
      pluginId: "alpha",
      msg: { type: "emitEvent", event: "e", args: [] },
    });
    deliver({ pluginId: "alpha", msg: { type: "activateError", error: "x" } });
    expect(seen).toHaveLength(5);
  });

  // §260 3c-2c security review (F1) — this suite's whole purpose, and it did not
  // cover the frame the phase added: `hostRequest` had no validator, so every
  // `ctx.ai.*` call was dropped here and failed 150s later on the sandbox's own
  // timeout. The machinery suites all drive the in-memory pair, which has no
  // validator, so they passed. The validator is now a discriminant-keyed record that
  // TypeScript will not let anyone extend the union without updating — this test
  // pins the runtime half of that.
  it("delivers a well-formed hostRequest and drops broken ones", async () => {
    const transport = await createHostTransport("alpha");
    const seen: SandboxToHost[] = [];
    transport.onMessage((m) => seen.push(m));

    for (const msg of [
      { type: "hostRequest", request: { kind: "ai_complete", prompt: "p" } }, // no requestId
      { type: "hostRequest", requestId: "r1" }, // no request
      { type: "hostRequest", requestId: "r1", request: null },
      { type: "hostRequest", requestId: "r1", request: { kind: "ai_dream" } },
      // `host-ai-bridge` dereferences `prompt`; without this check an `ai_complete`
      // with none would reach `llmComplete` as `undefined`.
      {
        type: "hostRequest",
        requestId: "r1",
        request: { kind: "ai_complete" },
      },
      {
        type: "hostRequest",
        requestId: "r1",
        request: { kind: "ai_stream", prompt: 42 },
      },
      {
        type: "hostRequest",
        requestId: "r1",
        request: { kind: "ai_complete", prompt: "p", opts: { maxTokens: "8" } },
      },
      // Indexing a plain object with an attacker-chosen discriminant would reach
      // Object.prototype and hand back a truthy function; the lookup is a Map.
      { type: "constructor" },
      { type: "toString" },
      {
        type: "hostRequest",
        requestId: "r1",
        request: { kind: "constructor" },
      },
    ]) {
      expect(() => deliver({ pluginId: "alpha", msg })).not.toThrow();
    }
    expect(seen).toEqual([]);

    for (const request of [
      { kind: "ai_complete", prompt: "p" },
      { kind: "ai_complete", prompt: "p", opts: { maxTokens: 10 } },
      { kind: "ai_complete", prompt: "p", opts: { systemPrompt: "s" } },
      { kind: "ai_list_models" },
      { kind: "ai_stream", prompt: "p" },
    ]) {
      deliver({
        pluginId: "alpha",
        msg: { type: "hostRequest", requestId: "r", request },
      });
    }
    expect(seen).toHaveLength(5);
  });

  // §260 Phase 4a — the same coverage for the frames THIS phase adds, written in the
  // same commit as the union members. That ordering is the lesson from F1: a member
  // without its validator entry ships the feature dead, and no other suite can see it.
  it("delivers well-formed ui requests and drops broken ones", async () => {
    const transport = await createHostTransport("alpha");
    const seen: SandboxToHost[] = [];
    transport.onMessage((m) => seen.push(m));

    for (const request of [
      { kind: "ui_notify" }, // no message
      { kind: "ui_notify", message: 42 },
      { kind: "ui_notify", message: "m", type: "fatal" }, // not a toast kind
      { kind: "ui_notify", message: "m", type: 1 },
      { kind: "ui_status_bar", text: "t" }, // no id
      { kind: "ui_status_bar", id: "s" }, // no text
      { kind: "ui_status_bar", id: 1, text: "t" },
      { kind: "ui_status_bar", id: "s", text: null },
    ]) {
      expect(() =>
        deliver({
          pluginId: "alpha",
          msg: { type: "hostRequest", requestId: "r", request },
        }),
      ).not.toThrow();
    }
    expect(seen).toEqual([]);

    for (const request of [
      { kind: "ui_notify", message: "m" },
      { kind: "ui_notify", message: "m", type: "error" },
      { kind: "ui_notify", message: "m", type: "info" },
      { kind: "ui_notify", message: "m", type: "warning" },
      { kind: "ui_status_bar", id: "s", text: "t" },
      // An empty string is legitimate: it is how a plugin clears its own item.
      { kind: "ui_status_bar", id: "s", text: "" },
    ]) {
      deliver({
        pluginId: "alpha",
        msg: { type: "hostRequest", requestId: "r", request },
      });
    }
    expect(seen).toHaveLength(6);
  });

  it("caps the document a plugin may install, at the frame", async () => {
    // §260 Phase 4b security review (MEDIUM-2) — `editor_set_markdown` is parsed and then
    // replaces the whole document in one transaction (a full re-render with NodeView
    // construction, measured in tens of seconds for a large document). Deferring to Rust's
    // 8 MiB report cap let one frame hang the app, 150 times a second. Refused HERE, before
    // the parse and the transaction, like any other malformed frame.
    const transport = await createHostTransport("alpha");
    const seen: SandboxToHost[] = [];
    transport.onMessage((m) => seen.push(m));

    const send = (markdown: string) =>
      deliver({
        pluginId: "alpha",
        msg: {
          type: "hostRequest",
          requestId: "r",
          request: { kind: "editor_set_markdown", markdown },
        },
      });

    // Comfortably larger than the project's own 10,000-line target, so a real document is
    // never the thing this refuses.
    send("x".repeat(2 * 1024 * 1024));
    expect(seen).toHaveLength(1);

    send("x".repeat(2 * 1024 * 1024 + 1));
    expect(seen).toHaveLength(1);
  });

  it("swallows a rejected send — the sandbox may not have connected yet", async () => {
    const transport = await createHostTransport("alpha");
    invoke.mockRejectedValueOnce(new Error("sandbox is not connected"));
    expect(() => transport.send({ type: "deactivate" })).not.toThrow();
    // let the rejection settle; an unhandled rejection would fail the run
    await Promise.resolve();
    await Promise.resolve();
  });

  it("close() unlistens and stops delivering", async () => {
    const transport = await createHostTransport("alpha");
    const seen: SandboxToHost[] = [];
    transport.onMessage((m) => seen.push(m));
    transport.close();
    expect(unlisten).toHaveBeenCalled();
    deliver({ pluginId: "alpha", msg: { type: "activateError", error: "x" } });
    expect(seen).toEqual([]);
  });

  // §260 3c-2a review (M5) — the handshake property, composed rather than in
  // pieces: `plugin_sandbox_send` rejects until the sandbox calls
  // `plugin_sandbox_connect`, and the session's retry is what makes activate land
  // anyway. Tested through the REAL transport so a `send` that stopped swallowing,
  // or a dropped retry, fails here.
  it("activate still lands when early sends are rejected until the sandbox connects", async () => {
    vi.useFakeTimers();
    try {
      const sent: unknown[] = [];
      let sandboxConnected = false;
      invoke.mockImplementation(async (cmd: string, args: { msg: unknown }) => {
        if (cmd !== "plugin_sandbox_send") return undefined;
        if (!sandboxConnected) throw new Error("sandbox is not connected");
        sent.push(args.msg);
        return undefined;
      });

      const transport = await createHostTransport("alpha");
      const session = new SandboxSession(transport);
      const activated = session.activate("alpha", DECLARED);

      await vi.advanceTimersByTimeAsync(300); // every send so far rejected
      expect(sent).toEqual([]);

      sandboxConnected = true; // the sandbox has now registered its channel
      await vi.advanceTimersByTimeAsync(300); // the retry re-sends and lands
      expect(sent.length).toBeGreaterThan(0);

      // The sandbox answers over the s2h path; activate resolves with the manifest.
      deliver({
        pluginId: "alpha",
        msg: { type: "ready", registered: { commands: ["ping"], events: [] } },
      });
      await expect(activated).resolves.toBe(DECLARED);
    } finally {
      vi.useRealTimers();
    }
  });

  // `unlisten()` invokes an IPC command, which can reject while the app is tearing
  // down; the mock rejects so an unhandled rejection would fail this run.
  it("close() swallows a rejected unlisten", async () => {
    unlisten.mockRejectedValueOnce(new Error("window gone"));
    const transport = await createHostTransport("alpha");
    expect(() => transport.close()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
