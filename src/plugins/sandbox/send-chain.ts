// §395 spec 0074 D12 · §5.4 — the host's frames to ONE sandbox, sent one after another: the next
// `plugin_sandbox_send` starts once the previous one has settled. `plugin_sandbox_send` is an `async`
// command, and two of them in flight finish in no defined order, so frames sent without waiting could
// take their `channel.send` in either order — the order the sandbox then sees (`channels.rs`). With
// the chain, the order is the order frames were handed in. A rejected send — the sandbox not connected
// yet in the activate retry window, or its channel gone after `close` — is logged and the chain goes
// on. The chain never reads whether the transport closed: `SandboxSession.dispose` hands in the answers
// it owes and `deactivate`, then closes in the same tick, and those frames must still leave.
import type { HostToSandbox } from "./protocol";

import { pluginSandboxSend } from "../../ipc/plugin-invoke";
import { logger } from "../../utils/logger";

/** Send `msg` after every frame handed in before it; a failure is logged as `[Sandbox] {failure} {id} failed`. Never throws. */
export type SendInOrder = (msg: HostToSandbox, failure: string) => void;

/**
 * One chain for one sandbox. With nothing in flight a frame leaves in the same tick (`pending` is 0 only
 * once the previous send and its bookkeeping have settled); otherwise it waits behind the chain's tail.
 */
export function createSendChain(pluginId: string): SendInOrder {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;
  return (msg, failure) => {
    const send = (): Promise<void> =>
      pluginSandboxSend(pluginId, msg)
        .catch((err: unknown) => {
          logger.debug(`[Sandbox] ${failure} ${pluginId} failed:`, err);
        })
        .finally(() => {
          pending -= 1;
        });
    pending += 1;
    tail = pending === 1 ? send() : tail.then(send);
  };
}
