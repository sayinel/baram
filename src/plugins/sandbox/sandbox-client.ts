// §260 Sandbox-side client — runs INSIDE the isolated plugin WebviewWindow. The
// only outward channel is the transport. Guards re-activation and serializes
// outbound payloads defensively (real Tauri events are serde-JSON, not
// structured clone — functions/BigInt/etc. would corrupt silently).
import type { NetworkAPI, StorageAPI } from "../types";
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
    network,
    storage,
  };

  async function onActivate(): Promise<void> {
    if (activateState !== "idle") return; // M4: ignore repeated activate
    activateState = "activating";
    commands.clear(); // each attempt starts clean — no stale regs from a failed retry
    eventHandlers.clear();
    try {
      // Our own bundle, resolved in Rust from this window's label. It arrives as an
      // invoke RESULT, so it never enters tauri's shared channel-data queue (which
      // is ACL-exempt and guessable — §260 3c-2a review I3).
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
