// §260 Test-only in-memory transport pair (async microtask delivery).
import type { HostToSandbox, SandboxToHost } from "../protocol";
import type { SandboxTransport } from "../transport";

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
