// §260 · §394 — the calls one sandbox session has in flight, by id: commands (`invokeCommand` →
// `callResult`) and `data-action` clicks (`invokeAction` → `actionResult`, spec 0073 D11 ③ · D13).
// One table, so each ends at `CALL_TIMEOUT_MS`, its timer stops while a prompt is open (§385 spec
// 0061 §6) and `dispose` rejects it. A class of its own so `SandboxSession` only routes to it, as
// it does to `SandboxRenderCalls` (plan 0125 Task 11).

import type { HostToSandbox, SandboxToHost } from "./protocol";

/** §394 Also the trusted tier's bound on a `data-action` handler (`plugin-action.ts`, spec 0073 D11 ③). */
export const CALL_TIMEOUT_MS = 30_000;

/** A command's or a `data-action`'s answer — the two frames `settle` takes. */
export type CallAnswer = Extract<
  SandboxToHost,
  { type: "actionResult" | "callResult" }
>;

/** The frames that start a call. */
type CallFrame = Extract<
  HostToSandbox,
  { type: "invokeAction" | "invokeCommand" }
>;

/**
 * §394 — each call's id prefix, by the one frame type that may answer it: commands and actions
 * share the table, so an `actionResult` must not settle `call-2`, nor a `callResult` `action-3`.
 */
const CALL_PREFIX: Record<CallAnswer["type"], string> = {
  actionResult: "action-",
  callResult: "call-",
};

interface Pending {
  /** A command id or `action:<value>`, kept so a timer rearmed after a prompt names it (§385 spec 0061 §6). */
  commandId: string;
  reject: (e: Error) => void;
  resolve: (v: unknown) => void;
  /** `null` while a prompt holds the timers. */
  timer: null | ReturnType<typeof setTimeout>;
}

export class SandboxCalls {
  /** True while a prompt occupies these calls' timers (§385 spec 0061 §6). */
  private held = false;
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  constructor(private readonly send: (frame: CallFrame) => void) {}

  /** Reject every call still waiting — the session is going away. */
  dispose(): void {
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error("Sandbox session disposed"));
    }
    this.pending.clear();
  }

  /**
   * §385 — a person choosing is not the plugin running (spec 0061 §6). ALL pending calls stop:
   * a prompt frame names no call, so the session cannot tell which command asked.
   */
  hold(): void {
    this.held = true;
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = null;
    }
  }

  /** Every pending call gets a fresh 30 s once the prompt settles. After `dispose` there are none. */
  resume(): void {
    this.held = false;
    for (const [id, pending] of this.pending) {
      if (!pending.timer) this.arm(id, pending);
    }
  }

  /**
   * The one answer path: only by the frame type `CALL_PREFIX` names, and only once — the entry
   * leaves the table here, or the next prompt to close arms a timer for it (`resume`).
   */
  settle(answer: CallAnswer): void {
    const id = answer.type === "callResult" ? answer.callId : answer.id;
    if (!id.startsWith(CALL_PREFIX[answer.type])) return;
    const p = this.pending.get(id);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    this.pending.delete(id);
    if (!answer.ok) p.reject(new Error(answer.error));
    else p.resolve(answer.type === "callResult" ? answer.value : undefined);
  }

  /**
   * Send one call and wait for its answer: the id is minted here with the prefix of the frame type
   * that may answer it, and `frame` builds the frame around it. `commandId` names the call in its
   * timeout message.
   */
  start(
    answeredBy: CallAnswer["type"],
    commandId: string,
    frame: (id: string) => CallFrame,
  ): Promise<unknown> {
    const id = `${CALL_PREFIX[answeredBy]}${++this.seq}`;
    return new Promise<unknown>((resolve, reject) => {
      const pending: Pending = { commandId, reject, resolve, timer: null };
      this.pending.set(id, pending);
      // A call started while a prompt is open waits for the prompt like the others (spec 0061 §6).
      if (!this.held) this.arm(id, pending);
      this.send(frame(id));
    });
  }

  private arm(id: string, pending: Pending): void {
    pending.timer = setTimeout(() => {
      this.pending.delete(id);
      pending.reject(
        new Error(`Sandbox command "${pending.commandId}" timed out`),
      );
    }, CALL_TIMEOUT_MS);
  }
}
