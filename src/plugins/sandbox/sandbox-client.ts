// §260 Sandbox-side client — runs INSIDE the isolated plugin WebviewWindow. The
// only outward channel is the transport. Guards re-activation and serializes
// outbound payloads defensively (real Tauri events are serde-JSON, not
// structured clone — functions/BigInt/etc. would corrupt silently).
import type { HostToSandbox, SandboxToHost } from "./protocol";
import type { SandboxTransport } from "./transport";

export interface SandboxContext {
  commands: {
    register(id: string, handler: (...args: unknown[]) => unknown): void;
  };
  events: {
    emit(event: string, ...args: unknown[]): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
  };
}

interface PluginModule {
  activate?: (ctx: SandboxContext) => Promise<unknown> | unknown;
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

function assertSerializable(value: unknown): void {
  // Throws on functions/BigInt/cycles/undefined-as-value that JSON (the wire
  // format for Tauri events) cannot faithfully carry.
  JSON.stringify(value, (_k, v) => {
    if (typeof v === "function" || typeof v === "bigint")
      throw new Error("value is not serializable");
    return v;
  });
}
