// §260 Sandbox-side client — runs INSIDE the isolated plugin WebviewWindow. The
// only outward channel is the transport. Guards re-activation and serializes
// outbound payloads defensively (real Tauri events are serde-JSON, not
// structured clone — functions/BigInt/etc. would corrupt silently).
import type { FilesAPI, NetworkAPI, StorageAPI } from "../types";
import type { PluginOp } from "./plugin-op";
import type { HostToSandbox, SandboxToHost } from "./protocol";
import type { SandboxTransport } from "./transport";

import { logger } from "../../utils/logger";

export interface SandboxContext {
  commands: {
    register(id: string, handler: (...args: unknown[]) => unknown): void;
  };
  events: {
    emit(event: string, ...args: unknown[]): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
  };
  // §260 3c-1 — brokered privileged APIs. Routed through `broker` (= plugin_call
  // in production). Exposed unconditionally: the Rust authorizer, keyed on the
  // Tauri-verified window.label(), is the real per-call capability gate — an
  // op for an unregistered capability fails closed there, not here.
  files: FilesAPI;
  network: NetworkAPI;
  storage: StorageAPI;
}

interface PluginModule {
  activate?: (ctx: SandboxContext) => Promise<unknown> | unknown;
}

export function startSandboxClient(
  transport: SandboxTransport<HostToSandbox, SandboxToHost>,
  // §260 3c-2b — takes the plugin's SOURCE, not a URL: production wraps it in a
  // blob URL (see sandbox-entry.ts), tests pass a module directly. Injectable so no
  // test needs `URL.createObjectURL`.
  importer: (source: string) => Promise<PluginModule>,
  broker: (op: PluginOp) => Promise<unknown>,
): void {
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let activateState: "activating" | "done" | "idle" = "idle";

  const storage: StorageAPI = {
    list: () => broker({ kind: "storage_list" }) as Promise<string[]>,
    read: (key) =>
      broker({ key, kind: "storage_read" }) as Promise<null | string>,
    remove: (key) => broker({ key, kind: "storage_remove" }) as Promise<void>,
    write: (key, value) =>
      broker({ key, kind: "storage_write", value }) as Promise<void>,
  };
  const network: NetworkAPI = {
    fetch: (url, init) =>
      broker({ init, kind: "http_fetch", url }) as ReturnType<
        NetworkAPI["fetch"]
      >,
  };
  // §260 3c-2c — same shape as the trusted tier's FilesAPI, so a plugin's file code
  // is tier-independent. Nothing is interpreted here: a broker rejection (denied
  // capability, path outside the vault, `.baram`, over the cap) propagates to the
  // plugin, because a sandbox that softened a deny into `undefined` would let the
  // plugin proceed as though the write had landed.
  const files: FilesAPI = {
    listDir: (path) =>
      broker({ kind: "files_list", path }) as Promise<string[]>,
    readFile: (path) => broker({ kind: "files_read", path }) as Promise<string>,
    writeFile: (path, content) =>
      broker({ content, kind: "files_write", path }) as Promise<void>,
  };

  const ctx: SandboxContext = {
    commands: { register: (id, handler) => void commands.set(id, handler) },
    events: {
      emit(event, ...args) {
        try {
          assertSerializable(args);
          transport.send({ type: "emitEvent", event, args });
        } catch {
          logger.warn(
            `[Sandbox] dropped unserializable emit for event "${event}"`,
          );
        }
      },
      on(event, handler) {
        const list = eventHandlers.get(event) ?? [];
        list.push(handler);
        eventHandlers.set(event, list);
      },
    },
    files,
    network,
    storage,
  };

  async function onActivate(): Promise<void> {
    if (activateState !== "idle") return; // M4: ignore repeated activate
    activateState = "activating";
    commands.clear(); // each attempt starts clean — no stale regs from a failed retry
    eventHandlers.clear();
    try {
      // Our own bundle, resolved in Rust from this window's label.
      //
      // ‼️ INVARIANT (§260 3c-2b review, M1): the result must stay a SCALAR JSON
      // string. An invoke result is not automatically safe from tauri's shared
      // channel-data queue — `ipc/protocol.rs` sends results through a `Channel`, and
      // `ipc/channel.rs` routes any payload ≥8 KiB whose JSON starts with `{` or `[`
      // through the app-global `ChannelDataIpcQueue`, fetched via the ACL-exempt
      // `FETCH_CHANNEL_DATA_COMMAND` with a guessable sequential id (3c-2a review
      // I3). Today this is safe on two counts: desktop uses the custom-protocol IPC
      // path (result returns as an HTTP body), and even on the postMessage fallback a
      // bare JSON string never matches the `{`/`[` condition. Wrap this in an object
      // (e.g. `{source, hash}`) and a 4 MiB bundle becomes stealable by another
      // sandbox on non-macOS — so if that shape must change, chunk it or keep it out
      // of the channel path deliberately.
      const source = await broker({ kind: "source_read" });
      if (typeof source !== "string") {
        throw new Error("broker returned a non-string plugin source");
      }
      const mod = await importer(source);
      if (typeof mod.activate === "function") await mod.activate(ctx);
      activateState = "done";
      transport.send({
        type: "ready",
        registered: {
          commands: [...commands.keys()],
          events: [...eventHandlers.keys()],
        },
      });
    } catch (err) {
      activateState = "idle";
      transport.send({
        type: "activateError",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onInvoke(
    callId: string,
    commandId: string,
    args: unknown[],
  ): Promise<void> {
    const handler = commands.get(commandId);
    if (!handler) {
      transport.send({
        type: "callResult",
        callId,
        ok: false,
        error: `No command "${commandId}"`,
      });
      return;
    }
    try {
      const value = await handler(...args);
      assertSerializable(value);
      transport.send({ type: "callResult", callId, ok: true, value });
    } catch (err) {
      transport.send({
        type: "callResult",
        callId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  transport.onMessage((m) => {
    switch (m.type) {
      case "activate":
        void onActivate();
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

function assertSerializable(value: unknown): void {
  // Throws on functions/BigInt/cycles that JSON (the wire format for Tauri
  // events) cannot faithfully carry.
  JSON.stringify(value, (_k, v) => {
    if (typeof v === "function" || typeof v === "bigint")
      throw new Error("value is not serializable");
    return v;
  });
}
