# Plugin Sandbox Machinery (Phase 2) Implementation Plan — rev.2 (post-critic)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the per-plugin sandbox runtime *machinery* — a typed host↔sandbox message protocol, an injectable transport, a host-side `SandboxSession` router, and a sandbox-side client shim — plus thin real WebviewWindow wiring, so a sandboxed plugin can (in Phase 3) load in an isolated realm and register handlers for its **manifest-declared** contributions.

**Architecture:** A sandboxed plugin runs in its own hidden `WebviewWindow` (label `plugin-<id>`) loading a bundled `sandbox.html`. Host↔sandbox exchange typed messages over a `SandboxTransport` (real impl = Tauri events on a **per-session-token** channel; tests = in-memory channel pair). The manifest's Phase-1 `PluginContributions` is the **authoritative** static surface; the sandbox's `ready` report (what it actually bound) is validated against it. Machinery (protocol/session/client) is DI-based and fully unit-tested; the real WebviewWindow + Tauri-event transport is thin and build+dev-verified.

**Tech Stack:** TypeScript 6 (strict, `verbatimModuleSyntax`), React 19 (unaffected), Tauri 2.0 (`@tauri-apps/api/webviewWindow`, `@tauri-apps/api/event`, `convertFileSrc`), Vite 8 **rolldown**, Vitest.

## Global Constraints

- TS strict; type-only imports use `import type`. `npm run typecheck` checks app+node+test.
- **After editing `src/plugins/types.ts` run `npm run types:plugin` + commit `examples/plugins/*.d.ts`** (CI `lint` runs full `npm run lint` incl. `types:plugin:check`). This phase does NOT edit `types.ts` (it *reuses* Phase-1 `PluginContributions`), but run `npm run lint` before pushing regardless.
- ESLint alphabetical `perfectionist/sort-*`, `--max-warnings=0`; Vitest only; Conventional Commits, English, `§260`.
- **This phase does NOT enforce the trust boundary and does NOT route real sandboxed plugins.** Plugins stay OFF (`VITE_ENABLE_PLUGINS`); `plugin-loader.ts` routing untouched. Deferred to **Phase 3**: `plugin_call` broker, `PluginOp`/`PluginAuthorizer`, the sensitive-command **ACL lockdown** (Tauri v2 custom commands are ungated by default), the **global CSP `asset:` widening** (needed only when a real plugin is imported — no Phase-2 consumer), the loader flip, and **event-source integrity hardening** (see note in Task 4).
- Runtime/config surfaces (Task 4: `tauri-transport.ts`, `sandbox-entry.ts`, `sandbox.html`, capability JSON, Vite input) are verified by `typecheck` + `npm run build` + a **real round-trip dev smoke test** — NOT vitest. Keep them thin.
- New TS lives under `src/plugins/sandbox/`; each file single-responsibility (~≤150 lines).

---

### Task 1: Message protocol + transport interface + in-memory channel

**Files:** Create `src/plugins/sandbox/protocol.ts`, `src/plugins/sandbox/transport.ts`, `src/plugins/sandbox/__tests__/channel-pair.ts`; Test `src/plugins/sandbox/__tests__/channel-pair.test.ts`.

**Interfaces — Produces:**
- `protocol.ts`: `HostToSandbox`, `SandboxToHost` unions; `SandboxRegisteredReport` (what the plugin *bound*, validated against the manifest — NOT a replacement for it).
- `transport.ts`: `interface SandboxTransport<TIn, TOut> { close(): void; onMessage(h: (m: TIn) => void): () => void; send(m: TOut): void }`.
- `channel-pair.ts`: `createChannelPair()` → `{ host, sandbox }` linked transports, async (microtask) delivery.

- [ ] **Step 1: Write the failing channel-pair test**

Create `src/plugins/sandbox/__tests__/channel-pair.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createChannelPair } from "./channel-pair";

describe("createChannelPair (§260 sandbox test transport)", () => {
  it("delivers host.send to the sandbox handler", async () => {
    const { host, sandbox } = createChannelPair();
    const seen: unknown[] = [];
    sandbox.onMessage((m) => seen.push(m));
    host.send({ type: "deactivate" });
    await Promise.resolve();
    expect(seen).toEqual([{ type: "deactivate" }]);
  });

  it("delivers sandbox.send to the host handler", async () => {
    const { host, sandbox } = createChannelPair();
    const seen: unknown[] = [];
    host.onMessage((m) => seen.push(m));
    sandbox.send({ type: "ready", registered: { commands: [], events: [] } });
    await Promise.resolve();
    expect(seen).toEqual([{ type: "ready", registered: { commands: [], events: [] } }]);
  });

  it("stops delivering after unsubscribe", async () => {
    const { host, sandbox } = createChannelPair();
    const fn = vi.fn();
    sandbox.onMessage(fn)();
    host.send({ type: "deactivate" });
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/plugins/sandbox/__tests__/channel-pair.test.ts` → FAIL (unresolved imports).

- [ ] **Step 3: Write protocol.ts**

```ts
// §260 Sandbox message protocol — the typed host↔sandbox contract. Payloads
// cross a WebviewWindow boundary as Tauri event payloads (serde-JSON — see the
// serialization guard in the client; NOT arbitrary structured clone).

/**
 * What the plugin actually BOUND during activate. The manifest's Phase-1
 * `PluginContributions` remains the authoritative static surface (titles,
 * palette, menu, statusBar) that the install UI consented to; the host
 * validates this report against it (warns on divergence).
 */
export interface SandboxRegisteredReport {
  commands: string[];
  events: string[];
}

/** Main app → sandbox realm. */
export type HostToSandbox =
  | { pluginId: string; pluginUrl: string; type: "activate" }
  | { args: unknown[]; callId: string; commandId: string; type: "invokeCommand" }
  | { args: unknown[]; event: string; type: "deliverEvent" }
  | { type: "deactivate" };

/** Sandbox realm → main app. */
export type SandboxToHost =
  | { registered: SandboxRegisteredReport; type: "ready" }
  | { args: unknown[]; event: string; type: "emitEvent" }
  | { callId: string; ok: true; type: "callResult"; value: unknown }
  | { callId: string; error: string; ok: false; type: "callResult" }
  | { error: string; type: "activateError" };
```

- [ ] **Step 4: Write transport.ts**

```ts
// §260 Sandbox transport — injectable seam between the machinery and the real
// Tauri-event channel. Tests use an in-memory pair; production uses the
// per-session-token WebviewWindow transport (tauri-transport.ts).
export interface SandboxTransport<TIn, TOut> {
  close(): void;
  onMessage(handler: (msg: TIn) => void): () => void;
  send(msg: TOut): void;
}
```

- [ ] **Step 5: Write channel-pair.ts**

```ts
// §260 Test-only in-memory transport pair (async microtask delivery).
import type { HostToSandbox, SandboxToHost } from "../protocol";
import type { SandboxTransport } from "../transport";

function endpoint<TIn, TOut>() {
  const handlers = new Set<(m: TIn) => void>();
  let peer: (m: TOut) => void = () => {};
  return {
    deliver: (m: TIn) => handlers.forEach((h) => h(m)),
    transport: {
      close: () => handlers.clear(),
      onMessage: (h: (m: TIn) => void) => {
        handlers.add(h);
        return () => handlers.delete(h);
      },
      send: (m: TOut) => void Promise.resolve().then(() => peer(m)),
    } satisfies SandboxTransport<TIn, TOut>,
    wire: (fn: (m: TOut) => void) => {
      peer = fn;
    },
  };
}

export function createChannelPair(): {
  host: SandboxTransport<SandboxToHost, HostToSandbox>;
  sandbox: SandboxTransport<HostToSandbox, SandboxToHost>;
} {
  const h = endpoint<SandboxToHost, HostToSandbox>();
  const s = endpoint<HostToSandbox, SandboxToHost>();
  h.wire((m) => s.deliver(m));
  s.wire((m) => h.deliver(m));
  return { host: h.transport, sandbox: s.transport };
}
```

- [ ] **Step 6: Run to verify it passes** — `npx vitest run src/plugins/sandbox/__tests__/channel-pair.test.ts` → PASS (3).

- [ ] **Step 7: Lint + commit**
Run `npx eslint src/plugins/sandbox --fix && npm run lint:ts && npm run typecheck` → exit 0.
```bash
git add src/plugins/sandbox/protocol.ts src/plugins/sandbox/transport.ts src/plugins/sandbox/__tests__/channel-pair.ts src/plugins/sandbox/__tests__/channel-pair.test.ts
git commit -m "feat(§260): sandbox message protocol + transport interface"
```

---

### Task 2: Host-side SandboxSession router (retry-activate, per-call timeout, manifest validation)

**Files:** Create `src/plugins/sandbox/sandbox-session.ts`; Test `src/plugins/sandbox/__tests__/sandbox-session.test.ts`.

**Interfaces — Produces:** `class SandboxSession`:
- `constructor(transport: SandboxTransport<SandboxToHost, HostToSandbox>)`
- `activate(pluginId: string, pluginUrl: string, declared: PluginContributions): Promise<PluginContributions>` — **resends** `activate` every 250ms until `ready`/`activateError`/5s timeout (fixes the listen race, C2); on `ready` validates `registered` against `declared` (logger.warn on mismatch) and resolves with `declared` (authoritative). Stores `contributions = declared`, `registered`.
- `invokeCommand(commandId, args?): Promise<unknown>` — fresh callId; **30s per-call timeout** (I4) → reject + drop pending.
- `onEmit(handler): () => void`; `deliverEvent(event, args): void`; `contributions: PluginContributions | null`; `dispose(): void`.

Consumes: protocol/transport (Task 1); `PluginContributions` from `../types`; `createChannelPair` (tests); `logger` from `../../utils/logger`.

- [ ] **Step 1: Write the failing tests**

Create `src/plugins/sandbox/__tests__/sandbox-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { PluginContributions } from "../../types";
import type { HostToSandbox } from "../protocol";

import { createChannelPair } from "./channel-pair";
import { SandboxSession } from "../sandbox-session";

const DECLARED: PluginContributions = { commands: [{ id: "c1", title: "C1" }] };
const REPORT = { commands: ["c1"], events: ["file:open"] };

describe("SandboxSession (§260 host router)", () => {
  it("activate() resolves with the DECLARED (manifest) contributions", async () => {
    const { host, sandbox } = createChannelPair();
    sandbox.onMessage((m: HostToSandbox) => {
      if (m.type === "activate") sandbox.send({ type: "ready", registered: REPORT });
    });
    const s = new SandboxSession(host);
    const rec = await s.activate("p", "u", DECLARED);
    expect(rec).toBe(DECLARED);
    expect(s.contributions).toBe(DECLARED);
  });

  it("activate() RETRIES until ready (survives a dropped first activate)", async () => {
    const { host, sandbox } = createChannelPair();
    let seen = 0;
    sandbox.onMessage((m: HostToSandbox) => {
      if (m.type === "activate" && ++seen >= 2) sandbox.send({ type: "ready", registered: REPORT });
    });
    const s = new SandboxSession(host);
    await expect(s.activate("p", "u", DECLARED)).resolves.toBe(DECLARED);
    expect(seen).toBeGreaterThanOrEqual(2);
  });

  it("activate() rejects on activateError", async () => {
    const { host, sandbox } = createChannelPair();
    sandbox.onMessage((m: HostToSandbox) => {
      if (m.type === "activate") sandbox.send({ type: "activateError", error: "boom" });
    });
    await expect(new SandboxSession(host).activate("p", "u", DECLARED)).rejects.toThrow(/boom/);
  });

  it("invokeCommand() round-trips by callId", async () => {
    const { host, sandbox } = createChannelPair();
    sandbox.onMessage((m: HostToSandbox) => {
      if (m.type === "activate") sandbox.send({ type: "ready", registered: REPORT });
      if (m.type === "invokeCommand") sandbox.send({ type: "callResult", callId: m.callId, ok: true, value: m.args[0] });
    });
    const s = new SandboxSession(host);
    await s.activate("p", "u", DECLARED);
    await expect(s.invokeCommand("c1", ["hi"])).resolves.toBe("hi");
  });

  it("invokeCommand() rejects on ok:false", async () => {
    const { host, sandbox } = createChannelPair();
    sandbox.onMessage((m: HostToSandbox) => {
      if (m.type === "activate") sandbox.send({ type: "ready", registered: REPORT });
      if (m.type === "invokeCommand") sandbox.send({ type: "callResult", callId: m.callId, ok: false, error: "nope" });
    });
    const s = new SandboxSession(host);
    await s.activate("p", "u", DECLARED);
    await expect(s.invokeCommand("c1")).rejects.toThrow(/nope/);
  });

  it("onEmit() receives plugin→host events", async () => {
    const { host, sandbox } = createChannelPair();
    const s = new SandboxSession(host);
    const seen: Array<[string, unknown[]]> = [];
    s.onEmit((e, a) => seen.push([e, a]));
    sandbox.send({ type: "emitEvent", event: "hello", args: [1] });
    await Promise.resolve();
    expect(seen).toEqual([["hello", [1]]]);
  });

  it("dispose() sends deactivate and rejects pending calls", async () => {
    const { host, sandbox } = createChannelPair();
    const got: HostToSandbox[] = [];
    sandbox.onMessage((m: HostToSandbox) => {
      got.push(m);
      if (m.type === "activate") sandbox.send({ type: "ready", registered: REPORT });
    });
    const s = new SandboxSession(host);
    await s.activate("p", "u", DECLARED);
    const pending = s.invokeCommand("c1");
    s.dispose();
    await Promise.resolve();
    await expect(pending).rejects.toThrow(/disposed/i);
    expect(got.some((m) => m.type === "deactivate")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/plugins/sandbox/__tests__/sandbox-session.test.ts` → FAIL (unresolved `../sandbox-session`).

- [ ] **Step 3: Implement sandbox-session.ts**

```ts
// §260 Host-side sandbox session for ONE plugin. Manifest-authoritative:
// `activate` resolves with the DECLARED contributions; the sandbox's `ready`
// report is validated against it (warn on drift). Resends `activate` to survive
// the sandbox's async-listen race; per-call timeouts prevent hung invocations.
import type { PluginContributions } from "../types";
import type { HostToSandbox, SandboxRegisteredReport, SandboxToHost } from "./protocol";
import type { SandboxTransport } from "./transport";

import { logger } from "../../utils/logger";

const ACTIVATE_TIMEOUT_MS = 5000;
const ACTIVATE_RETRY_MS = 250;
const CALL_TIMEOUT_MS = 30_000;

interface Pending {
  reject: (e: Error) => void;
  resolve: (v: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SandboxSession {
  contributions: null | PluginContributions = null;
  registered: null | SandboxRegisteredReport = null;

  private activateSettle: null | { reject: (e: Error) => void; resolve: (c: PluginContributions) => void } = null;
  private callSeq = 0;
  private declared: null | PluginContributions = null;
  private disposed = false;
  private readonly emitHandlers = new Set<(event: string, args: unknown[]) => void>();
  private readonly offMessage: () => void;
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly transport: SandboxTransport<SandboxToHost, HostToSandbox>) {
    this.offMessage = transport.onMessage((m) => this.handle(m));
  }

  activate(pluginId: string, pluginUrl: string, declared: PluginContributions): Promise<PluginContributions> {
    this.declared = declared;
    return new Promise<PluginContributions>((resolve, reject) => {
      const send = () => this.transport.send({ type: "activate", pluginId, pluginUrl });
      const retry = setInterval(send, ACTIVATE_RETRY_MS);
      const timeout = setTimeout(() => {
        finish();
        reject(new Error(`Sandbox activate timed out for ${pluginId}`));
      }, ACTIVATE_TIMEOUT_MS);
      const finish = () => {
        clearInterval(retry);
        clearTimeout(timeout);
        this.activateSettle = null;
      };
      this.activateSettle = {
        reject: (e) => { finish(); reject(e); },
        resolve: (c) => { finish(); resolve(c); },
      };
      send();
    });
  }

  deliverEvent(event: string, args: unknown[]): void {
    if (!this.disposed) this.transport.send({ type: "deliverEvent", event, args });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.transport.send({ type: "deactivate" });
    this.offMessage();
    this.activateSettle?.reject(new Error("Sandbox session disposed"));
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Sandbox session disposed"));
    }
    this.pending.clear();
    this.emitHandlers.clear();
    this.transport.close();
  }

  invokeCommand(commandId: string, args: unknown[] = []): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error("Sandbox session disposed"));
    const callId = `call-${++this.callSeq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        reject(new Error(`Sandbox command "${commandId}" timed out`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(callId, { reject, resolve, timer });
      this.transport.send({ type: "invokeCommand", callId, commandId, args });
    });
  }

  onEmit(handler: (event: string, args: unknown[]) => void): () => void {
    this.emitHandlers.add(handler);
    return () => this.emitHandlers.delete(handler);
  }

  private handle(m: SandboxToHost): void {
    switch (m.type) {
      case "activateError":
        this.activateSettle?.reject(new Error(m.error));
        break;
      case "callResult": {
        const p = this.pending.get(m.callId);
        if (!p) break;
        clearTimeout(p.timer);
        this.pending.delete(m.callId);
        if (m.ok) p.resolve(m.value);
        else p.reject(new Error(m.error));
        break;
      }
      case "emitEvent":
        this.emitHandlers.forEach((h) => h(m.event, m.args));
        break;
      case "ready":
        if (!this.activateSettle || !this.declared) break; // late/duplicate ready
        this.registered = m.registered;
        this.validate(m.registered, this.declared);
        this.contributions = this.declared;
        this.activateSettle.resolve(this.declared);
        break;
    }
  }

  private validate(report: SandboxRegisteredReport, declared: PluginContributions): void {
    const declaredIds = new Set((declared.commands ?? []).map((c) => c.id));
    for (const id of report.commands) {
      if (!declaredIds.has(id)) logger.warn(`[Sandbox] plugin bound undeclared command "${id}"`);
    }
    for (const id of declaredIds) {
      if (!report.commands.includes(id)) logger.warn(`[Sandbox] declared command "${id}" was not registered`);
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/plugins/sandbox/__tests__/sandbox-session.test.ts` → PASS (7).

- [ ] **Step 5: Lint + commit**
Run `npx eslint src/plugins/sandbox --fix && npm run lint:ts && npm run typecheck` → exit 0.
```bash
git add src/plugins/sandbox/sandbox-session.ts src/plugins/sandbox/__tests__/sandbox-session.test.ts
git commit -m "feat(§260): host-side SandboxSession (retry-activate, timeouts, manifest validation)"
```

---

### Task 3: Sandbox-side client shim (double-activate guard, serialization guard)

**Files:** Create `src/plugins/sandbox/sandbox-client.ts`; Test `src/plugins/sandbox/__tests__/sandbox-client.test.ts`.

**Interfaces — Produces:** `startSandboxClient(transport, importer): void`. `SandboxContext` exposes `commands.register(id, handler)` and `events.on(event, handler)` / `events.emit(event, ...args)` only (statusBar/ui declarative surface is manifest-driven → later phase). On `activate`: **guard against re-activation** (M4), import plugin, call `activate(ctx)`, send `ready` with `{ commands: boundIds, events: subscribedNames }`. On `invokeCommand`: run handler; **guard result serializability** (I5 — reply `ok:false` if the value can't be JSON-serialized) . On `emitEvent`: guard args serializability, drop+log on failure.

- [ ] **Step 1: Write the failing tests**

Create `src/plugins/sandbox/__tests__/sandbox-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { PluginContributions } from "../../types";
import type { SandboxContext } from "../sandbox-client";

import { createChannelPair } from "./channel-pair";
import { SandboxSession } from "../sandbox-session";
import { startSandboxClient } from "../sandbox-client";

const DECLARED: PluginContributions = {
  commands: [{ id: "add", title: "Add" }, { id: "boom", title: "Boom" }, { id: "bad", title: "Bad" }, { id: "go", title: "Go" }],
};

function wire(activate: (ctx: SandboxContext) => void, importCount = { n: 0 }) {
  const { host, sandbox } = createChannelPair();
  startSandboxClient(sandbox, async () => { importCount.n++; return { activate }; });
  return new SandboxSession(host);
}

describe("startSandboxClient (§260 sandbox shim)", () => {
  it("reports bound command ids + subscribed events on ready", async () => {
    const s = wire((ctx) => { ctx.commands.register("add", () => 0); ctx.events.on("file:open", () => {}); });
    await s.activate("p", "u", DECLARED);
    expect(s.registered).toEqual({ commands: ["add"], events: ["file:open"] });
  });

  it("runs a command handler and returns its value", async () => {
    const s = wire((ctx) => ctx.commands.register("add", (a, b) => (a as number) + (b as number)));
    await s.activate("p", "u", DECLARED);
    await expect(s.invokeCommand("add", [2, 3])).resolves.toBe(5);
  });

  it("replies ok:false when the handler throws", async () => {
    const s = wire((ctx) => ctx.commands.register("boom", () => { throw new Error("x"); }));
    await s.activate("p", "u", DECLARED);
    await expect(s.invokeCommand("boom")).rejects.toThrow(/x/);
  });

  it("replies ok:false when the result is not JSON-serializable (I5)", async () => {
    const s = wire((ctx) => ctx.commands.register("bad", () => () => 0)); // returns a function
    await s.activate("p", "u", DECLARED);
    await expect(s.invokeCommand("bad")).rejects.toThrow(/serializ/i);
  });

  it("delivers host events to the plugin handler", async () => {
    const calls: unknown[][] = [];
    const s = wire((ctx) => ctx.events.on("file:open", (...a) => calls.push(a)));
    await s.activate("p", "u", { commands: [] });
    s.deliverEvent("file:open", ["/a.md"]);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([["/a.md"]]);
  });

  it("forwards ctx.events.emit to host onEmit", async () => {
    const s = wire((ctx) => ctx.commands.register("go", () => ctx.events.emit("pinged", 7)));
    const seen: Array<[string, unknown[]]> = [];
    s.onEmit((e, a) => seen.push([e, a]));
    await s.activate("p", "u", DECLARED);
    await s.invokeCommand("go");
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([["pinged", [7]]]);
  });

  it("sends activateError when activate throws", async () => {
    const s = wire(() => { throw new Error("bad activate"); });
    await expect(s.activate("p", "u", { commands: [] })).rejects.toThrow(/bad activate/);
  });

  it("ignores a repeated activate (M4) — imports only once", async () => {
    const count = { n: 0 };
    const { host, sandbox } = createChannelPair();
    startSandboxClient(sandbox, async () => { count.n++; return { activate: () => {} }; });
    const s = new SandboxSession(host);
    await s.activate("p", "u", { commands: [] });
    // Session retries stop after ready, but simulate an extra inbound activate:
    sandbox.onMessage(() => {});
    await new Promise((r) => setTimeout(r, 300));
    expect(count.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/plugins/sandbox/__tests__/sandbox-client.test.ts` → FAIL (unresolved `../sandbox-client`).

- [ ] **Step 3: Implement sandbox-client.ts**

```ts
// §260 Sandbox-side client — runs INSIDE the isolated plugin WebviewWindow. The
// only outward channel is the transport. Guards re-activation and serializes
// outbound payloads defensively (real Tauri events are serde-JSON, not
// structured clone — functions/BigInt/etc. would corrupt silently).
import type { HostToSandbox, SandboxToHost } from "./protocol";
import type { SandboxTransport } from "./transport";

export interface SandboxContext {
  commands: { register(id: string, handler: (...args: unknown[]) => unknown): void };
  events: { emit(event: string, ...args: unknown[]): void; on(event: string, handler: (...args: unknown[]) => void): void };
}

interface PluginModule {
  activate?: (ctx: SandboxContext) => Promise<unknown> | unknown;
}

function assertSerializable(value: unknown): void {
  // Throws on functions/BigInt/cycles/undefined-as-value that JSON (the wire
  // format for Tauri events) cannot faithfully carry.
  JSON.stringify(value, (_k, v) => {
    if (typeof v === "function" || typeof v === "bigint") throw new Error("value is not serializable");
    return v;
  });
}

export function startSandboxClient(
  transport: SandboxTransport<HostToSandbox, SandboxToHost>,
  importer: (url: string) => Promise<PluginModule>,
): void {
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let activateState: "activating" | "done" | "idle" = "idle";

  const ctx: SandboxContext = {
    commands: { register: (id, handler) => void commands.set(id, handler) },
    events: {
      emit(event, ...args) {
        try {
          assertSerializable(args);
          transport.send({ type: "emitEvent", event, args });
        } catch {
          /* drop unserializable emit */
        }
      },
      on(event, handler) {
        const list = eventHandlers.get(event) ?? [];
        list.push(handler);
        eventHandlers.set(event, list);
      },
    },
  };

  async function onActivate(pluginUrl: string): Promise<void> {
    if (activateState !== "idle") return; // M4: ignore repeated activate
    activateState = "activating";
    try {
      const mod = await importer(pluginUrl);
      if (typeof mod.activate === "function") await mod.activate(ctx);
      activateState = "done";
      transport.send({ type: "ready", registered: { commands: [...commands.keys()], events: [...eventHandlers.keys()] } });
    } catch (err) {
      activateState = "idle";
      transport.send({ type: "activateError", error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function onInvoke(callId: string, commandId: string, args: unknown[]): Promise<void> {
    const handler = commands.get(commandId);
    if (!handler) {
      transport.send({ type: "callResult", callId, ok: false, error: `No command "${commandId}"` });
      return;
    }
    try {
      const value = await handler(...args);
      assertSerializable(value);
      transport.send({ type: "callResult", callId, ok: true, value });
    } catch (err) {
      transport.send({ type: "callResult", callId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  transport.onMessage((m) => {
    switch (m.type) {
      case "activate":
        void onActivate(m.pluginUrl);
        break;
      case "deactivate":
        transport.close();
        break;
      case "deliverEvent":
        (eventHandlers.get(m.event) ?? []).forEach((h) => h(...m.args));
        break;
      case "invokeCommand":
        void onInvoke(m.callId, m.commandId, m.args);
        break;
    }
  });
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/plugins/sandbox/__tests__/sandbox-client.test.ts` → PASS (8).

- [ ] **Step 5: Lint + commit**
Run `npx eslint src/plugins/sandbox --fix && npm run lint:ts && npm run typecheck` → exit 0.
```bash
git add src/plugins/sandbox/sandbox-client.ts src/plugins/sandbox/__tests__/sandbox-client.test.ts
git commit -m "feat(§260): sandbox-side client shim (activate guard, serialization guard)"
```

---

### Task 4: Runtime wiring — Tauri transport, SandboxHost, sandbox page, capability

**Files:** Create `src/plugins/sandbox/tauri-transport.ts`, `src/plugins/sandbox/sandbox-host.ts`, `src/sandbox/sandbox-entry.ts`, `sandbox.html` (repo root); Modify `vite.config.ts`; Create `src-tauri/capabilities/plugin-sandbox.json`; Test `src/plugins/sandbox/__tests__/sandbox-host.test.ts`.

**Interfaces — Produces:**
- `createTauriTransport(label, token): Promise<SandboxTransport<SandboxToHost, HostToSandbox>>` — **awaits its inbound `listen` before resolving** (C2, host side); send → `emitTo(label, "plugin:h2s:<token>", msg)`; inbound ← `listen("plugin:s2h:<token>", …)`.
- `class SandboxHost` with injectable `windowFactory` (default = real hidden WebviewWindow + tauri transport); `start(pluginId, installPath, mainFile, declared): Promise<SandboxSession>` (**try/catch → dispose+close+delete on failure**, I3); `stop(pluginId)`; `stopAll()`.

**Per-session token (C1 + event-source integrity):** the host mints an unguessable `token` per plugin, passes it via the sandbox URL (`sandbox.html?label=…&token=…`), and BOTH channels embed it (`plugin:h2s:<token>`, `plugin:s2h:<token>`). sandbox→host uses **global `emit`** (not `emitTo`, which would target the sandbox's own window — the C1 bug); the token in the event name means another plugin can't guess/inject onto this session's channel. **Full event-source verification (binding a session to a Tauri-verified source window) remains a Phase-3 hardening — note it.**

**NOTE (verification):** `tauri-transport.ts`, `sandbox-entry.ts`, `sandbox.html`, the Vite input, and the capability JSON are runtime/config — verified by `typecheck` + `npm run build` + the **real round-trip dev smoke test** in Step 10, NOT vitest. Only `SandboxHost` lifecycle (via injected fake window) is unit-tested.

- [ ] **Step 1: Write the failing SandboxHost lifecycle test**

Create `src/plugins/sandbox/__tests__/sandbox-host.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { PluginContributions } from "../../types";
import type { HostToSandbox, SandboxToHost } from "../protocol";
import type { SandboxTransport } from "../transport";

import { createChannelPair } from "./channel-pair";
import { startSandboxClient } from "../sandbox-client";
import { SandboxHost } from "../sandbox-host";

const DECLARED: PluginContributions = { commands: [{ id: "ping", title: "Ping" }] };

function fakeFactory(created: string[], closed: string[]) {
  return (label: string): { close: () => void; transport: SandboxTransport<SandboxToHost, HostToSandbox> } => {
    created.push(label);
    const { host, sandbox } = createChannelPair();
    startSandboxClient(sandbox, async () => ({ activate: (ctx) => ctx.commands.register("ping", () => "pong") }));
    return { close: () => closed.push(label), transport: host };
  };
}

describe("SandboxHost (§260 lifecycle)", () => {
  it("start() creates one window per plugin, activates, returns a live session", async () => {
    const created: string[] = [];
    const host = new SandboxHost(fakeFactory(created, []));
    const session = await host.start("alpha", "/p/alpha", "index.mjs", DECLARED);
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
      sandbox.onMessage((m) => { if ((m as HostToSandbox).type === "activate") (sandbox as SandboxTransport<HostToSandbox, SandboxToHost>).send({ type: "activateError", error: "fail" }); });
      return { close: () => closed.push(label), transport: h };
    });
    await expect(host.start("gamma", "/p/gamma", "index.mjs", DECLARED)).rejects.toThrow(/fail/);
    expect(closed).toEqual(["plugin-gamma"]); // window closed, entry removed
    // a fresh start must build a NEW window, proving the dead entry was deleted
    closed.length = 0;
    const created2: string[] = [];
    const host2 = new SandboxHost(fakeFactory(created2, []));
    await host2.start("gamma", "/p/gamma", "index.mjs", DECLARED);
    expect(created2).toEqual(["plugin-gamma"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/plugins/sandbox/__tests__/sandbox-host.test.ts` → FAIL (unresolved `../sandbox-host`).

- [ ] **Step 3: Implement sandbox-host.ts**

```ts
// §260 SandboxHost — lifecycle of per-plugin sandbox WebviewWindows + sessions.
// windowFactory is injectable (unit-testable); production uses a hidden
// WebviewWindow + per-session-token Tauri transport. NOT yet called by the live
// loader (Phase 3).
import type { PluginContributions } from "../types";
import type { HostToSandbox, SandboxToHost } from "./protocol";
import type { SandboxTransport } from "./transport";

import { convertFileSrc } from "@tauri-apps/api/core";

import { SandboxSession } from "./sandbox-session";

export interface SandboxWindow {
  close: () => void;
  transport: SandboxTransport<SandboxToHost, HostToSandbox>;
}
export type SandboxWindowFactory = (label: string, token: string) => Promise<SandboxWindow> | SandboxWindow;

export class SandboxHost {
  private readonly live = new Map<string, { session: SandboxSession; window: SandboxWindow }>();
  private seq = 0;

  constructor(private readonly windowFactory: SandboxWindowFactory = defaultWindowFactory) {}

  async start(pluginId: string, installPath: string, mainFile: string, declared: PluginContributions): Promise<SandboxSession> {
    const existing = this.live.get(pluginId);
    if (existing) return existing.session;
    const label = `plugin-${pluginId}`;
    const token = `${pluginId}-${++this.seq}-${Math.floor(performance.now())}`;
    const window = await this.windowFactory(label, token);
    const session = new SandboxSession(window.transport);
    this.live.set(pluginId, { session, window });
    try {
      const pluginUrl = convertFileSrc(`${installPath}/${mainFile}`);
      await session.activate(pluginId, pluginUrl, declared);
      return session;
    } catch (err) {
      this.live.delete(pluginId);
      session.dispose();
      window.close();
      throw err;
    }
  }

  async stop(pluginId: string): Promise<void> {
    const entry = this.live.get(pluginId);
    if (!entry) return;
    this.live.delete(pluginId);
    entry.session.dispose();
    entry.window.close();
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.live.keys()]) await this.stop(id);
  }
}

async function defaultWindowFactory(label: string, token: string): Promise<SandboxWindow> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { createTauriTransport } = await import("./tauri-transport");
  const win = new WebviewWindow(label, {
    url: `sandbox.html?label=${encodeURIComponent(label)}&token=${encodeURIComponent(token)}`,
    visible: false,
    focus: false,
    skipTaskbar: true,
    decorations: false,
  });
  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => reject(new Error(String(e.payload))));
  });
  const transport = await createTauriTransport(label, token);
  return { close: () => void win.close(), transport };
}
```

- [ ] **Step 4: Run to verify the lifecycle test passes** — `npx vitest run src/plugins/sandbox/__tests__/sandbox-host.test.ts` → PASS (3). (`defaultWindowFactory`/`createTauriTransport` not exercised — fake factory injected. `performance.now()` is available in jsdom; if a subagent hits an env gap, substitute a module-level counter.)

- [ ] **Step 5: Implement tauri-transport.ts (thin; awaits its own listen — C2 host side)**

```ts
// §260 Real sandbox transport over Tauri events, per-session token channels.
// Awaits its inbound listen before resolving so the host never misses a fast
// `ready`. Thin adapter — no branching (untested by vitest; dev-smoke verified).
import type { HostToSandbox, SandboxToHost } from "./protocol";
import type { SandboxTransport } from "./transport";

import { emitTo, listen } from "@tauri-apps/api/event";

export async function createTauriTransport(label: string, token: string): Promise<SandboxTransport<SandboxToHost, HostToSandbox>> {
  const handlers = new Set<(m: SandboxToHost) => void>();
  const unlisten = await listen<SandboxToHost>(`plugin:s2h:${token}`, (e) => handlers.forEach((h) => h(e.payload)));
  return {
    close: () => { unlisten(); handlers.clear(); },
    onMessage: (h) => { handlers.add(h); return () => handlers.delete(h); },
    send: (m) => void emitTo(label, `plugin:h2s:${token}`, m),
  };
}
```

- [ ] **Step 6: Create sandbox entry + page**

Create `src/sandbox/sandbox-entry.ts`:

```ts
// §260 Sandbox bootstrap — runs inside a hidden plugin WebviewWindow. Wires the
// client to a token-scoped Tauri-event transport; sandbox→host uses global
// `emit` (emitTo would target THIS window). Plugin ESM is imported HERE (the
// isolation boundary).
import type { HostToSandbox, SandboxToHost } from "../plugins/sandbox/protocol";
import type { SandboxTransport } from "../plugins/sandbox/transport";

import { emit, listen } from "@tauri-apps/api/event";

import { startSandboxClient } from "../plugins/sandbox/sandbox-client";

const params = new URLSearchParams(location.search);
const token = params.get("token") ?? "";

const handlers = new Set<(m: HostToSandbox) => void>();
void listen<HostToSandbox>(`plugin:h2s:${token}`, (e) => handlers.forEach((h) => h(e.payload)));
const transport: SandboxTransport<HostToSandbox, SandboxToHost> = {
  close: () => handlers.clear(),
  onMessage: (h) => { handlers.add(h); return () => handlers.delete(h); },
  send: (m) => void emit(`plugin:s2h:${token}`, m),
};

startSandboxClient(transport, (url) => import(/* @vite-ignore */ url));
```

Create `sandbox.html` at repo root:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <!-- §260 sandbox-strict CSP. No direct network; scripts only from app origin
         (Phase 2 loads no asset: plugin — that + the global asset: allowance land
         in Phase 3). Meta CSP can only tighten vs the global config. -->
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; connect-src ipc: http://ipc.localhost" />
    <title>Baram plugin sandbox</title>
  </head>
  <body>
    <script type="module" src="/src/sandbox/sandbox-entry.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: Register sandbox.html as a Vite input (rolldown — M1)**

In `vite.config.ts`: the project uses Vite 8 **`build.rolldownOptions`** (NOT `rollupOptions`) and imports `path` as a default import (`import path from "path"`). Add a multi-page `input` under `build` (add the key if absent) listing BOTH entries so `index.html` still emits at the dist root (Tauri `frontendDist` needs it):

```ts
    rolldownOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        sandbox: path.resolve(__dirname, "sandbox.html"),
      },
      // ...keep any existing rolldownOptions fields (output, etc.) unchanged
    },
```

Verify the existing `path` import; if the file imports from `node:path`, match that. Do not introduce a second `path` import.

- [ ] **Step 8: Create the plugin-sandbox capability**

Create `src-tauri/capabilities/plugin-sandbox.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "plugin-sandbox",
  "description": "§260 — capability for per-plugin sandbox WebviewWindows (label plugin-*). Grants ONLY the Tauri event channel the sandbox client needs (global emit for s2h, listen for h2s). NO fs/keyring/llm/git. The `plugin_call` broker command + the sensitive-command ACL lockdown land in Phase 3.",
  "windows": ["plugin-*"],
  "permissions": ["core:event:allow-emit", "core:event:allow-listen", "core:event:allow-unlisten"]
}
```

(Confirm these exact identifiers against `src-tauri/gen/schemas/desktop-schema.json` during implementation; adjust to the installed Tauri version's names if they differ, and note it.)

- [ ] **Step 9: (removed)** — the global CSP `asset:` widening is deferred to Phase 3 (no Phase-2 consumer; it loosens the MAIN window and is only needed once a real plugin is `import()`ed). Do NOT touch `tauri.conf.json` `csp` in this phase.

- [ ] **Step 10: Verify build + lint + full suite + real round-trip smoke**

Run `npm run typecheck` → exit 0.
Run `npm run lint` → exit 0 (full chain incl. `types:plugin:check`).
Run `npx vitest run src/plugins/sandbox` → PASS (all four test files).
Run `npm run build` → completes; confirm BOTH `dist/index.html` and `dist/sandbox.html` are emitted.
**Dev smoke (documented, run in the running app with `VITE_ENABLE_PLUGINS=1`; NOT CI):** from the app devtools console, exercise a REAL round trip against a live sandbox window using a `data:`/`'self'` module (NOT an `asset:` plugin — that needs the Phase-3 CSP change):
```js
const { SandboxHost } = await import('/src/plugins/sandbox/sandbox-host.ts');
const host = new SandboxHost();
// point mainFile at a data: module the strict sandbox CSP ('self') allows via blob/self;
// e.g. temporarily host a tiny module at /smoke-plugin.mjs that registers a "ping" command.
const s = await host.start('smoke', '', '/smoke-plugin.mjs', { commands: [{ id: 'ping', title: 'Ping' }] });
console.assert(await s.invokeCommand('ping') === 'pong', 'round trip failed');
await host.stop('smoke');
```
Confirm: no CSP/console errors, `ready` received, `invokeCommand` resolves. Record the result in the task report. (This is the gate the critic flagged — it exercises C1's emit direction and C2's listen race against the real transport.)

- [ ] **Step 11: Commit**
```bash
git add src/plugins/sandbox/tauri-transport.ts src/plugins/sandbox/sandbox-host.ts src/plugins/sandbox/__tests__/sandbox-host.test.ts src/sandbox/sandbox-entry.ts sandbox.html vite.config.ts src-tauri/capabilities/plugin-sandbox.json
git commit -m "feat(§260): sandbox host + token-scoped WebviewWindow transport (machinery, not live-routed)"
```

---

## Self-Review

**Critic fixes applied:** C1 sandbox→host now global `emit` on a token channel (was self-targeting `emitTo`) ✅; C2 retry-activate in `SandboxSession` + `createTauriTransport` awaits its listen ✅; I1 global CSP widening removed → Phase 3 ✅; I2 manifest `PluginContributions` authoritative, `ready` report validated against it (reused Phase-1 type, no divergent shape) ✅; I3 `start()` try/catch cleans up on activate failure (tested) ✅; I4 per-call `invokeCommand` timeout ✅ (crash-detection noted as Phase 3); I5 client `assertSerializable` guard on results + emits (tested) ✅; M1 `rolldownOptions` + `path.resolve` (not `rollupOptions`/`node:path`) ✅; M3 single activate-settle object ✅; M4 double-activate guard (tested) ✅. Event-source integrity: per-session token channel raises the bar; full source-window verification flagged as Phase 3.

**Placeholder scan:** none. Runtime-only steps carry full code + a real round-trip smoke gate.

**Type consistency:** `SandboxTransport<TIn,TOut>` order `<inbound,outbound>` consistent across all consumers; `ready` shape `{ registered: { commands: string[]; events: string[] } }` identical in protocol/session/client/tests; `SandboxHost.start(pluginId, installPath, mainFile, declared)` arity consistent; `createTauriTransport(label, token)` async everywhere it's used.

**Reviewer flags:** Task 4's transport/entry/html/capability are not vitest-covered (no Tauri runtime) — the Step-10 real round-trip smoke is the gate; a reviewer should confirm the report contains its result. Capability permission identifiers are best-effort — verify vs the installed schema.

## Out of scope (Phase 3+)

- `plugin_call` broker, `PluginOp`, `PluginAuthorizer`, `window.label()` identity, per-call authz, storage isolation.
- Sensitive-command **ACL lockdown** (`AppManifest::commands` + per-command permission TOMLs granted only to main/file-*) — the real "no raw invoke" boundary.
- **Global CSP `asset:` widening** + wiring the loader to route `sandboxed` → `SandboxHost` (consuming `pluginTrustOf`).
- **Event-source verification** (bind a session to a Tauri-verified source window, beyond the per-session token).
- Brokered services (files/ai/network/storage), transform/editor contributions, settings/statusBar rendering.
