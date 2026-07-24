// §260 Host-side sandbox session for ONE plugin. Manifest-authoritative:
// `activate` resolves with the DECLARED contributions; the sandbox's `ready`
// report is validated against it (warn on drift). Resends `activate` to survive
// the sandbox's async-listen race; per-call timeouts prevent hung invocations.
import type { PluginContributions } from "../types";
import type {
  HostToSandbox,
  SandboxRegisteredReport,
  SandboxToHost,
} from "./protocol";
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

  private activateSettle: null | {
    reject: (e: Error) => void;
    resolve: (c: PluginContributions) => void;
  } = null;
  private callSeq = 0;
  private declared: null | PluginContributions = null;
  private disposed = false;
  private readonly emitHandlers = new Set<
    (event: string, args: unknown[]) => void
  >();
  private readonly offMessage: () => void;
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly transport: SandboxTransport<SandboxToHost, HostToSandbox>,
  ) {
    this.offMessage = transport.onMessage((m) => this.handle(m));
  }

  activate(
    pluginId: string,
    pluginUrl: string,
    declared: PluginContributions,
  ): Promise<PluginContributions> {
    this.declared = declared;
    return new Promise<PluginContributions>((resolve, reject) => {
      const send = () =>
        this.transport.send({ type: "activate", pluginId, pluginUrl });
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
        reject: (e) => {
          finish();
          reject(e);
        },
        resolve: (c) => {
          finish();
          resolve(c);
        },
      };
      send();
    });
  }

  deliverEvent(event: string, args: unknown[]): void {
    if (!this.disposed)
      this.transport.send({ type: "deliverEvent", event, args });
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
    if (this.disposed)
      return Promise.reject(new Error("Sandbox session disposed"));
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

  private validate(
    report: SandboxRegisteredReport,
    declared: PluginContributions,
  ): void {
    const declaredIds = new Set((declared.commands ?? []).map((c) => c.id));
    for (const id of report.commands) {
      if (!declaredIds.has(id))
        logger.warn(`[Sandbox] plugin bound undeclared command "${id}"`);
    }
    for (const id of declaredIds) {
      if (!report.commands.includes(id))
        logger.warn(`[Sandbox] declared command "${id}" was not registered`);
    }
  }
}
