# Plugin Sandbox Loader Flip (§260 Phase 3c-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the plugin loader so a `sandboxed` plugin runs in a hidden `plugin-*` WebviewWindow via the Phase-2 `SandboxHost` (instead of loading in the main JS realm), wire the frontend `plugin_call`/register/deregister, expose a brokered `storage`+`network` context inside the sandbox, widen CSP so plugin ESM loads, and gate sandbox-webview creation to dev-only — all CI-verified via the injectable fake transport, with plugins still OFF by default.

**Architecture:** `PluginLoader.loadPlugin` branches on `pluginTrustOf(manifest)`: `trusted` keeps today's same-realm path; `sandboxed` registers the plugin's capabilities with the Rust authorizer (`plugin_sandbox_register`), starts a `SandboxHost` session (hidden `plugin-*` webview), consumes the `ready` report, and maps the declared **commands** onto the host palette with each action routed back through `session.invokeCommand` (host→sandbox). Inside the sandbox webview, the plugin's `activate(ctx)` receives a context whose `storage`/`network` call `plugin_call` directly (the only privileged channel a `plugin-*` window has after the Phase-3b ACL lockdown); the Rust authorizer (Phase 3a) enforces per-call capability by the Tauri-verified `window.label()`. `legacy` (no `trust`) manifests are refused (need re-validation).

**Tech Stack:** TypeScript/React, Tauri v2 (`invoke`, `WebviewWindow`, event transport), the Phase-2 `src/plugins/sandbox/*` machinery, Vitest with injected fakes.

## Global Constraints

- **Scope = 3c-1 only.** In: TS IPC wrappers; sandbox-side `storage`+`network` broker context; loader `sandboxed` branch + `SandboxHost` lifecycle + command→palette mapping; CSP `asset:` widening; dev-only sandbox-webview release gate. **Deferred (do NOT build here):** brokered `files`/`ai` ops + new Rust `PluginOp` variants → **3c-2**; the real-WebviewWindow LIVE round-trip smoke → **3c-3**; declarative statusbar/menu/settings/sidebar contribution mapping for sandboxed plugins → later (3c-1 maps **commands/palette** only, enough to prove the host↔sandbox invoke round-trip).
- **Plugins stay OFF.** Do not change `arePluginsEnabled()` semantics. The whole path is inert unless `VITE_ENABLE_PLUGINS=1`. Additionally, sandbox-webview *creation* must be gated to dev (`import.meta.env.DEV`) so no release build can create a `plugin-*` webview before Phase 5.
- **Rust is the boundary, not the JS context.** The sandbox `storage`/`network` APIs are exposed unconditionally and call `plugin_call`; enforcement is the Rust authorizer (fails closed if the capability was not registered for that `window.label()`). Do NOT rely on the JS side to gate privilege.
- **No new Rust.** Phase 3a already shipped `plugin_call` + `plugin_sandbox_register`/`deregister` and the `PluginOp` union (`StorageRead/Write/List/Remove` + `HttpFetch`). 3c-1 is frontend + config only. The TS `PluginOp` type must mirror the Rust serde contract exactly: internally tagged on `"kind"`, `snake_case` variants (`storage_read`,`storage_write`,`storage_list`,`storage_remove`,`http_fetch`).
- **Injectability for CI.** Every Tauri touchpoint (`invoke`, `SandboxHost`'s `windowFactory`, the sandbox client's `pluginCall`) must be injectable so tests use fakes — the real WebviewWindow/event path is exercised only in 3c-3 (manual). No test may create a real webview.
- **TS conventions:** `import type` for types (`verbatimModuleSyntax`); `useShallow` for any Zustand selector in components (none expected here); files ≤ ~300 lines.

---

### Task 1: Frontend IPC wrappers + typed `PluginOp`

**Files:**
- Modify: `src/ipc/plugin-invoke.ts` (add 3 wrappers)
- Create: `src/plugins/sandbox/plugin-op.ts` (the TS `PluginOp` union mirroring the Rust serde contract)
- Test: `src/ipc/__tests__/plugin-invoke.sandbox.test.ts`

**Interfaces:**
- Consumes: Phase-3a Rust commands `plugin_call(op)`, `plugin_sandbox_register(pluginId, capabilities)`, `plugin_sandbox_deregister(pluginId)`.
- Produces: `pluginCall(op: PluginOp): Promise<unknown>`, `pluginSandboxRegister(pluginId: string, capabilities: string[]): Promise<void>`, `pluginSandboxDeregister(pluginId: string): Promise<void>`, and the `PluginOp` type (storage + network variants).

- [ ] **Step 1: Write the failing test** — `src/ipc/__tests__/plugin-invoke.sandbox.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import {
  pluginCall,
  pluginSandboxDeregister,
  pluginSandboxRegister,
} from "../plugin-invoke";

describe("sandbox IPC wrappers", () => {
  it("pluginCall forwards the op under the `op` arg key", async () => {
    invoke.mockResolvedValueOnce("v");
    const op = { kind: "storage_read", key: "k" } as const;
    await expect(pluginCall(op)).resolves.toBe("v");
    expect(invoke).toHaveBeenCalledWith("plugin_call", { op });
  });

  it("pluginSandboxRegister passes pluginId + capabilities", async () => {
    invoke.mockResolvedValueOnce(undefined);
    await pluginSandboxRegister("p1", ["storage", "network"]);
    expect(invoke).toHaveBeenCalledWith("plugin_sandbox_register", {
      pluginId: "p1",
      capabilities: ["storage", "network"],
    });
  });

  it("pluginSandboxDeregister passes pluginId", async () => {
    invoke.mockResolvedValueOnce(undefined);
    await pluginSandboxDeregister("p1");
    expect(invoke).toHaveBeenCalledWith("plugin_sandbox_deregister", {
      pluginId: "p1",
    });
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — `npm test -- plugin-invoke.sandbox` → FAIL (`pluginCall` etc. not exported / module `plugin-op` missing).

- [ ] **Step 3: Create `src/plugins/sandbox/plugin-op.ts`** — mirror the Rust `PluginOp` (see `src-tauri/src/plugin/authorizer.rs`, serde `#[serde(tag = "kind", rename_all = "snake_case")]`). 3c-1 = storage + network only (files/ai land in 3c-2):

```ts
// §260 — TS mirror of the Rust `PluginOp` (authorizer.rs). Internally tagged on
// `kind`, snake_case, so it serializes to exactly what the broker deserializes.
// 3c-1 covers storage + network; files/ai variants are added in Phase 3c-2.
export type PluginOp =
  | { kind: "storage_read"; key: string }
  | { kind: "storage_write"; key: string; value: string }
  | { kind: "storage_list" }
  | { kind: "storage_remove"; key: string }
  | { kind: "http_fetch"; url: string; init?: PluginFetchInit };

import type { PluginFetchInit } from "../types";
```

(Place the `import type` at the top per lint; shown inline here for locality.)

- [ ] **Step 4: Add the 3 wrappers to `src/ipc/plugin-invoke.ts`** (follow the existing `invoke<T>("cmd", {args})` pattern in that file):

```ts
import type { PluginOp } from "../plugins/sandbox/plugin-op";

/** §260 sandbox broker — the only privileged channel a plugin-* window has. */
export async function pluginCall(op: PluginOp): Promise<unknown> {
  return invoke<unknown>("plugin_call", { op });
}

/** §260 host-only — register a sandbox plugin's granted capabilities. */
export async function pluginSandboxRegister(
  pluginId: string,
  capabilities: string[],
): Promise<void> {
  return invoke<void>("plugin_sandbox_register", { pluginId, capabilities });
}

/** §260 host-only — drop a sandbox plugin's registered capabilities. */
export async function pluginSandboxDeregister(pluginId: string): Promise<void> {
  return invoke<void>("plugin_sandbox_deregister", { pluginId });
}
```

- [ ] **Step 5: Run the test, watch it pass** — `npm test -- plugin-invoke.sandbox` → 3/3 pass.
- [ ] **Step 6: Typecheck + commit** — `npm run typecheck` clean; `git add` the two changed/created files + test; commit `feat(§260): frontend plugin_call/register/deregister IPC wrappers (Phase 3c-1)`.

---

### Task 2: Sandbox-side brokered `storage` + `network` context

**Files:**
- Modify: `src/plugins/sandbox/sandbox-client.ts` (extend `SandboxContext` + `startSandboxClient` to inject a broker)
- Modify: `src/sandbox/sandbox-entry.ts` (pass the real `pluginCall` as the broker)
- Test: `src/plugins/sandbox/__tests__/sandbox-client.broker.test.ts`

**Interfaces:**
- Consumes: `pluginCall` from Task 1 (injected, not imported directly, so tests use a fake).
- Produces: `SandboxContext` gains `storage: StorageAPI` and `network: NetworkAPI` (reuse the shapes from `src/plugins/types.ts`); `startSandboxClient(transport, importer, broker)` gains a third param `broker: (op: PluginOp) => Promise<unknown>`.

- [ ] **Step 1: Write the failing test** — `src/plugins/sandbox/__tests__/sandbox-client.broker.test.ts`. Use the in-memory `channel-pair` helper already in `__tests__/`. Drive an `activate` whose plugin module calls `ctx.storage.write("k","v")` then `ctx.storage.read("k")`, and assert the injected `broker` received `{kind:"storage_write",key:"k",value:"v"}` then `{kind:"storage_read",key:"k"}`. (Model the test on the existing `sandbox-client.test.ts`.)

```ts
import { describe, expect, it, vi } from "vitest";
import { makeChannelPair } from "./channel-pair";
import { startSandboxClient } from "../sandbox-client";
import type { PluginOp } from "../plugin-op";

it("exposes storage/network that route through the injected broker", async () => {
  const { hostSide, sandboxSide } = makeChannelPair(); // (matches existing helper's API)
  const ops: PluginOp[] = [];
  const broker = vi.fn(async (op: PluginOp) => {
    ops.push(op);
    return op.kind === "storage_read" ? "v" : undefined;
  });
  const pluginModule = {
    activate: async (ctx: {
      storage: { read: (k: string) => Promise<unknown>; write: (k: string, v: string) => Promise<void> };
    }) => {
      await ctx.storage.write("k", "v");
      await ctx.storage.read("k");
    },
  };
  startSandboxClient(sandboxSide, async () => pluginModule, broker);
  hostSide.send({ type: "activate", pluginId: "p", pluginUrl: "x" });
  await vi.waitFor(() => expect(ops.length).toBe(2));
  expect(ops[0]).toEqual({ kind: "storage_write", key: "k", value: "v" });
  expect(ops[1]).toEqual({ kind: "storage_read", key: "k" });
});
```

(Adjust `makeChannelPair`/transport wiring to the actual helper signature in `channel-pair.ts` — read it first.)

- [ ] **Step 2: Run it, watch it fail** — `startSandboxClient` takes only 2 args; `ctx.storage` undefined.

- [ ] **Step 3: Extend `sandbox-client.ts`.** Add `broker` param; build `storage`/`network` on `ctx`:

```ts
import type { PluginOp } from "./plugin-op";
import type { NetworkAPI, StorageAPI } from "../types";

export interface SandboxContext {
  commands: { register(id: string, handler: (...a: unknown[]) => unknown): void };
  events: { emit(e: string, ...a: unknown[]): void; on(e: string, h: (...a: unknown[]) => void): void };
  storage: StorageAPI;
  network: NetworkAPI;
}

export function startSandboxClient(
  transport: SandboxTransport<HostToSandbox, SandboxToHost>,
  importer: (url: string) => Promise<PluginModule>,
  broker: (op: PluginOp) => Promise<unknown>,
): void {
  // ...existing commands/events...
  const storage: StorageAPI = {
    read: (key) => broker({ kind: "storage_read", key }) as Promise<string | null>,
    write: (key, value) => broker({ kind: "storage_write", key, value }) as Promise<void>,
    list: () => broker({ kind: "storage_list" }) as Promise<string[]>,
    remove: (key) => broker({ kind: "storage_remove", key }) as Promise<void>,
  };
  const network: NetworkAPI = {
    fetch: (url, init) => broker({ kind: "http_fetch", url, init }) as ReturnType<NetworkAPI["fetch"]>,
  };
  const ctx: SandboxContext = { commands: /*…*/, events: /*…*/, storage, network };
  // ...rest unchanged...
}
```

Keep the existing `assertSerializable` guards on emit/callResult. Do NOT gate `storage`/`network` by capability in JS — the Rust authorizer is the gate (a `broker` call for an unregistered capability rejects). Add a one-line comment saying so.

- [ ] **Step 4: Wire the real broker in `src/sandbox/sandbox-entry.ts`.** Import `pluginCall` and pass it:

```ts
import { pluginCall } from "../ipc/plugin-invoke";
// ...
startSandboxClient(transport, (url) => import(/* @vite-ignore */ url), (op) => pluginCall(op));
```

- [ ] **Step 5: Run the test, watch it pass.** Then `npm test -- sandbox-client` (existing suite still green — the 2-arg call sites in existing tests must be updated to pass a no-op broker; update them).
- [ ] **Step 6: Typecheck + commit** — `feat(§260): brokered storage/network in sandbox context via plugin_call (Phase 3c-1)`.

---

### Task 3: Loader `sandboxed` branch + `SandboxHost` lifecycle + dev release gate

**Files:**
- Modify: `src/plugins/plugin-loader.ts` (branch + sandbox load/unload)
- Modify: `src/plugins/plugins-enabled.ts` (add `isSandboxRuntimeAllowed()`)
- Test: `src/plugins/__tests__/plugin-loader.sandbox.test.ts`

**Interfaces:**
- Consumes: `pluginTrustOf` (`plugin-trust.ts`), `SandboxHost` (`sandbox/sandbox-host.ts`: `start(id, installPath, main, declared) → SandboxSession`, `stop(id)`), `SandboxSession` (`.contributions`, `.invokeCommand(id)`, `.onEmit`), `pluginSandboxRegister`/`Deregister` (Task 1), `usePluginUIStore().registerPaletteCommand/removePaletteCommand`, `arePluginsEnabled`.
- Produces: `PluginLoader` accepts an injected `SandboxHost` (default real) so tests inject a fake with a fake `windowFactory`; sandboxed plugins register/start/map-commands on load and stop/deregister/unregister on unload.

- [ ] **Step 1: Add the dev release gate** to `src/plugins/plugins-enabled.ts`:

```ts
// §260 — sandbox WebviewWindow creation stays dev-only until Phase 5 lifts the
// release gate. Even if a build somehow enabled plugins, a packaged (non-dev)
// artifact must never spawn a plugin-* webview. Read at call time for tests.
export function isSandboxRuntimeAllowed(): boolean {
  return import.meta.env.DEV && arePluginsEnabled();
}
```

- [ ] **Step 2: Write the failing test** — `src/plugins/__tests__/plugin-loader.sandbox.test.ts`. `vi.stubEnv("VITE_ENABLE_PLUGINS","1")`; mock `@tauri-apps/api/core` invoke + the `plugin-invoke` register/deregister; inject a **fake `SandboxHost`** whose `start` returns a fake session with `contributions = { commands: [{ id: "hello", title: "Hello" }] }` and a spy `invokeCommand`. Assert loading a `trust:"sandboxed"` manifest: (a) calls `pluginSandboxRegister(id, manifest.capabilities)`, (b) calls `host.start(id, installPath, main, contributions)`, (c) registers palette command `${id}.hello` whose invocation calls `session.invokeCommand("hello")`. Assert unload calls `host.stop(id)` + `pluginSandboxDeregister(id)`. Add a second test: a `trust` absent (legacy) manifest throws "needs re-validation"; and `isSandboxRuntimeAllowed()===false` (simulate non-dev) makes the sandboxed load throw before `host.start`.

(Write concrete assertions with the fakes; model wiring on `plugin-loader.test.ts`.)

- [ ] **Step 3: Run it, watch it fail.**

- [ ] **Step 4: Implement in `plugin-loader.ts`.** Constructor takes an optional `SandboxHost` (default `new SandboxHost()`). In `loadPlugin`, after the `arePluginsEnabled()` gate and manifest validation, branch:

```ts
import { pluginTrustOf } from "./plugin-trust";
import { SandboxHost } from "./sandbox/sandbox-host";
import { isSandboxRuntimeAllowed } from "./plugins-enabled";
import { pluginSandboxDeregister, pluginSandboxRegister } from "../ipc/plugin-invoke";
import { usePluginUIStore } from "./plugin-ui-store";

const trust = pluginTrustOf(manifest);
if (trust === null) {
  throw new Error(`Plugin ${manifest.id} predates the trust model and needs re-validation (#260).`);
}
if (trust === "sandboxed") {
  await this.loadSandboxedPlugin(installPath, manifest);
  return;
}
// trusted → existing same-realm path (unchanged)
```

`loadSandboxedPlugin` (new private method):

```ts
private async loadSandboxedPlugin(installPath: string, manifest: PluginManifest): Promise<void> {
  if (!isSandboxRuntimeAllowed()) {
    throw new Error(`Sandbox runtime is gated off in this build (#260 Phase 5).`);
  }
  await pluginSandboxRegister(manifest.id, manifest.capabilities);
  let session: SandboxSession;
  try {
    session = await this.sandboxHost.start(
      manifest.id, installPath, manifest.main, manifest.contributions ?? {},
    );
  } catch (err) {
    await pluginSandboxDeregister(manifest.id); // roll back the grant on failed start
    throw err;
  }
  const disposables: Disposable[] = [];
  for (const cmd of session.contributions?.commands ?? []) {
    const fullId = `${manifest.id}.${cmd.id}`;
    usePluginUIStore.getState().registerPaletteCommand({
      commandId: fullId, pluginId: manifest.id, title: cmd.title ?? cmd.id,
      run: () => void session.invokeCommand(cmd.id),
    });
    disposables.push({ dispose: () => usePluginUIStore.getState().removePaletteCommand(fullId) });
  }
  disposables.push({
    dispose: () => { void this.sandboxHost.stop(manifest.id); void pluginSandboxDeregister(manifest.id); },
  });
  this.loaded.set(manifest.id, {
    id: manifest.id, manifest, module: {}, context: undefined as never, disposables,
  });
}
```

(Confirm the `registerPaletteCommand` signature in `plugin-ui-store.ts` — if it stores only `{commandId, pluginId, title}` and dispatches via a separate command registry, adapt: register a host command handler keyed `fullId` whose body calls `session.invokeCommand`. Read the store + how the palette executes a command, and wire the sandbox command into the SAME execution path trusted plugins use, so the palette invokes it identically.) The `LoadedPlugin` shape may need `module`/`context` optional for the sandbox case — adjust `types.ts` `LoadedPlugin` minimally if required, or store a discriminant.

`unloadPlugin` already disposes `plugin.disposables`; the sandbox `stop`+`deregister`+`removePaletteCommand` disposables above make unload work with no special-casing. Verify the existing `unloadPlugin` deactivate/dispose loop tolerates a sandbox entry (no `module.deactivate`).

- [ ] **Step 5: Run tests, watch them pass** — the new suite + `npm test -- plugin-loader` (existing trusted-path tests still green).
- [ ] **Step 6: Typecheck + commit** — `feat(§260): route sandboxed plugins through SandboxHost + dev release gate (Phase 3c-1)`.

---

### Task 4: CSP `asset:` widening for plugin ESM

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`app.security.csp`)

**Interfaces:** none (config). Enables `import(convertFileSrc(pluginMain))` (an `asset:` URL) to load as a module in both the sandbox webview and the trusted main-realm path — today's `script-src 'self'` blocks it.

- [ ] **Step 1: Widen `script-src`.** Change the `script-src` directive from `'self'` to `'self' asset: http://asset.localhost` (mirror the hosts already trusted for `connect-src`/`frame-src` in the same CSP). Leave all other directives unchanged.

- [ ] **Step 2: Document the tradeoff inline is not possible in JSON** — instead add a one-line note to the PR body: asset-protocol scope is runtime-limited to plugin dirs (`plugin_prepare_scopes`/dev folders), so only plugin files are loadable as `asset:` scripts; this is required for the plugin system (both tiers) and plugins remain OFF by default.

- [ ] **Step 3: Verify the config parses + app builds** — `cd src-tauri && cargo build 2>&1 | tail -5` (Tauri validates `tauri.conf.json` at build; a malformed CSP fails here). No automated CSP test; the effective load is proven in the 3c-3 live smoke.

- [ ] **Step 4: Commit** — `feat(§260): allow asset: in script-src so plugin ESM loads (Phase 3c-1)`.

---

## Verification (before PR / merge)

- `npm test` — full vitest suite green (existing + new sandbox/loader/wrapper tests). Confirm the sandbox path is exercised only via fakes (no real webview).
- `npm run typecheck` — clean (3 projects).
- `npm run lint` — clean (includes format/knip; note: no `types.ts` public-API change expected, but if `LoadedPlugin`/types change, run `npm run types:plugin` — see the §260 recurring lesson).
- `cd src-tauri && cargo build` — clean (validates the CSP change).
- **Manual sanity (optional, not the 3c-3 gate):** `VITE_ENABLE_PLUGINS=1 npm run dev` still boots with zero sandboxed plugins installed (the branch is dormant).

**Deferred to later 3c steps (do NOT attempt here):** brokered `files`/`ai` + Rust `PluginOp` variants (3c-2); the real-WebviewWindow LIVE round-trip smoke — activate a real sandboxed reference plugin, invoke a command, round-trip a `storage` op through the real Tauri-event + `plugin_call` path (3c-3, user-run, the definitive proof); declarative statusbar/menu/settings/sidebar mapping for sandboxed plugins.

## Self-Review notes

- **Spec coverage (ADR §10 "3c = loader flip + brokered files/ai wiring + CSP + live smoke"):** 3c-1 delivers the loader flip + CSP + the storage/network broker + the register/deregister wiring + the release gate. files/ai → 3c-2; live smoke → 3c-3 (per the approved 3-way split).
- **Boundary:** a sandboxed plugin's only privileged channel is `plugin_call` (Phase-3b ACL); the sandbox context's `storage`/`network` route there; the Rust authorizer (Phase 3a) enforces per-call by `window.label()`. legacy manifests refused; sandbox-webview creation dev-gated until Phase 5.
- **No regression to trusted plugins:** the `trusted` branch is the untouched existing path; existing loader tests must stay green.
- **Type consistency:** TS `PluginOp` `kind` values (`storage_read`/`storage_write`/`storage_list`/`storage_remove`/`http_fetch`) match the Rust serde `#[serde(tag="kind", rename_all="snake_case")]` variants exactly, or `plugin_call` deserialization fails at runtime.
- **Injectability:** `invoke`, `SandboxHost.windowFactory`, and the client `broker` are all injected in tests; no test creates a real webview.
