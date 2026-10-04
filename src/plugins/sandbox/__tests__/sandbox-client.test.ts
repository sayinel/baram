import type { PluginContributions } from "../../types";
import type { SandboxContext } from "../../types";
import type { PluginOp } from "../plugin-op";
import type { SandboxHostRequest, SandboxToHost } from "../protocol";

import { describe, expect, it } from "vitest";

import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

const DECLARED: PluginContributions = {
  commands: [
    { id: "add", title: "Add" },
    { id: "boom", title: "Boom" },
    { id: "bad", title: "Bad" },
    { id: "go", title: "Go" },
  ],
};

// §260 3c-2b — the client asks the broker for its own source before
// importing, so a broker that answers nothing would fail activation.
const sourceBroker = async (op: PluginOp) =>
  op.kind === "source_read" ? "// bundle" : undefined;

function wire(activate: (ctx: SandboxContext) => void) {
  const { host, sandbox } = createChannelPair();
  startSandboxClient(sandbox, async () => ({ activate }), sourceBroker);
  return new SandboxSession(host);
}

describe("startSandboxClient (§260 sandbox shim)", () => {
  it("reports bound command ids + subscribed events on ready", async () => {
    const s = wire((ctx) => {
      ctx.commands.register("add", () => 0);
      ctx.events.on("file:open", () => {});
    });
    await s.activate("p", DECLARED);
    expect(s.registered).toEqual({ commands: ["add"], events: ["file:open"] });
  });

  it("runs a command handler and returns its value", async () => {
    const s = wire((ctx) =>
      ctx.commands.register("add", (a, b) => (a as number) + (b as number)),
    );
    await s.activate("p", DECLARED);
    await expect(s.invokeCommand("add", [2, 3])).resolves.toBe(5);
  });

  it("replies ok:false when the handler throws", async () => {
    const s = wire((ctx) =>
      ctx.commands.register("boom", () => {
        throw new Error("x");
      }),
    );
    await s.activate("p", DECLARED);
    await expect(s.invokeCommand("boom")).rejects.toThrow(/x/);
  });

  it("replies ok:false when the result is not JSON-serializable (I5)", async () => {
    const s = wire((ctx) => ctx.commands.register("bad", () => () => 0)); // returns a function
    await s.activate("p", DECLARED);
    await expect(s.invokeCommand("bad")).rejects.toThrow(/serializ/i);
  });

  it("delivers host events to the plugin handler", async () => {
    const calls: unknown[][] = [];
    const s = wire((ctx) =>
      ctx.events.on("file:open", (...a) => calls.push(a)),
    );
    await s.activate("p", { commands: [] });
    s.deliverEvent("file:open", ["/a.md"]);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([["/a.md"]]);
  });

  it("forwards ctx.events.emit to host onEmit", async () => {
    const s = wire((ctx) =>
      ctx.commands.register("go", () => ctx.events.emit("pinged", 7)),
    );
    const seen: Array<[string, unknown[]]> = [];
    s.onEmit((e, a) => seen.push([e, a]));
    await s.activate("p", DECLARED);
    await s.invokeCommand("go");
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([["pinged", [7]]]);
  });

  it("sends activateError when activate throws", async () => {
    const s = wire(() => {
      throw new Error("bad activate");
    });
    await expect(s.activate("p", { commands: [] })).rejects.toThrow(
      /bad activate/,
    );
  });

  it("ignores a SECOND activate arriving while the first import is still pending (M4)", async () => {
    const count = { n: 0 };
    let resolveImport!: (mod: {
      activate: (ctx: SandboxContext) => void;
    }) => void;
    const pendingImport = new Promise<{
      activate: (ctx: SandboxContext) => void;
    }>((resolve) => {
      resolveImport = resolve;
    });
    const { host, sandbox } = createChannelPair();
    startSandboxClient(
      sandbox,
      async () => {
        count.n++;
        return pendingImport;
      },
      sourceBroker,
    );

    // Drive host->sandbox directly: the first activate starts importing and
    // never resolves yet, so a genuine re-entrant guard is the only thing
    // that can stop the second activate from importing again.
    host.send({ type: "activate", pluginId: "p" });
    await Promise.resolve();
    host.send({ type: "activate", pluginId: "p" });
    await Promise.resolve();

    resolveImport({ activate: () => {} });
    await new Promise((r) => setTimeout(r, 0));

    expect(count.n).toBe(1);
  });

  it("recovers after activateError — a retry re-activates cleanly with no stale registrations", async () => {
    let attempt = 0;
    const { host, sandbox } = createChannelPair();
    startSandboxClient(
      sandbox,
      async () => {
        attempt++;
        if (attempt === 1) {
          return {
            activate: (ctx: SandboxContext) => {
              ctx.commands.register("stale", () => 0);
              throw new Error("first attempt fails");
            },
          };
        }
        return {
          activate: (ctx: SandboxContext) => {
            ctx.commands.register("fresh", () => 0);
          },
        };
      },
      sourceBroker,
    );
    const s = new SandboxSession(host);
    await expect(s.activate("p", { commands: [] })).rejects.toThrow(
      /first attempt fails/,
    );

    await s.activate("p", { commands: [] });
    expect(s.registered).toEqual({ commands: ["fresh"], events: [] });
  });
});

// §388 spec 0067 §8 · §10 — the editor frames as the client builds them, and the failure
// frame's `code` carried onto the plugin's error. The host is played by hand here, so the
// frames are exactly what a test sends; `editor-end-to-end.test.ts` drives the real session.
describe("startSandboxClient editor (§388)", () => {
  const REF = "0123456789abcdef0123456789abcdef";

  /** A booted client, the host end of its channel, and every request it sent. */
  async function boot() {
    const { host, sandbox } = createChannelPair();
    const requests: Array<{ request: SandboxHostRequest; requestId: string }> =
      [];
    let ready = () => {};
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    host.onMessage((m: SandboxToHost) => {
      if (m.type === "hostRequest") requests.push(m);
      if (m.type === "ready") ready();
    });
    let ctx: SandboxContext | undefined;
    startSandboxClient(
      sandbox,
      async () => ({
        activate: (c: SandboxContext) => {
          ctx = c;
        },
      }),
      sourceBroker,
    );
    host.send({ type: "activate", pluginId: "p" });
    await isReady;
    if (!ctx) throw new Error("activate did not run");
    return { ctx, host, requests };
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("keeps a listed refusal code on the plugin's error, and drops one that is not listed", async () => {
    const { ctx, host, requests } = await boot();

    const listed = ctx.editor.insertMarkdown("x");
    await flush();
    host.send({
      code: "ref-unknown",
      error: "e",
      ok: false,
      requestId: requests[0].requestId,
      type: "hostResponse",
    });
    await expect(listed).rejects.toMatchObject({
      code: "ref-unknown",
      message: "e",
      name: "EditorRefusal",
    });

    // The list is the contract plugins branch on: a code outside it is not passed on.
    const unlisted = ctx.editor.insertMarkdown("x");
    await flush();
    host.send({
      code: "evil",
      error: "e",
      ok: false,
      requestId: requests[1].requestId,
      type: "hostResponse",
    });
    const err = await unlisted.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("e");
    expect(err).not.toHaveProperty("code");
  });

  it("sends replace only when the plugin passed one", async () => {
    const { ctx, host, requests } = await boot();
    const writes = [
      ctx.editor.insertMarkdown("a"),
      ctx.editor.insertMarkdown("b", { replace: REF }),
      ctx.editor.insertText("c"),
      ctx.editor.insertText("d", { replace: REF }),
    ];
    await flush();
    expect(requests.map((r) => r.request)).toEqual([
      { kind: "editor_insert_markdown", markdown: "a" },
      { kind: "editor_insert_markdown", markdown: "b", replace: REF },
      { kind: "editor_insert_text", text: "c" },
      { kind: "editor_insert_text", replace: REF, text: "d" },
    ]);
    // `toEqual` passes a key holding `undefined` as absent, so absence is checked by key.
    expect(Object.keys(requests[0].request)).not.toContain("replace");
    expect(Object.keys(requests[2].request)).not.toContain("replace");
    for (const { requestId } of requests) {
      host.send({
        ok: true,
        requestId,
        type: "hostResponse",
        value: undefined,
      });
    }
    await Promise.all(writes);
  });

  it("getSelection hands back the ref the host answered inline", async () => {
    const { ctx, host, requests } = await boot();
    const reading = ctx.editor.getSelection();
    await flush();
    host.send({
      ok: true,
      requestId: requests[0].requestId,
      type: "hostResponse",
      value: { from: 3, ref: REF, staged: false, to: 3 },
    });
    await expect(reading).resolves.toEqual({
      from: 3,
      ref: REF,
      text: "",
      to: 3,
    });
  });
});
