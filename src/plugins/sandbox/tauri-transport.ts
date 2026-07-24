import { emitTo, listen } from "@tauri-apps/api/event";

// §260 Real sandbox transport over Tauri events, per-session token channels.
// Awaits its inbound listen before resolving so the host never misses a fast
// `ready`. Thin adapter — no branching (untested by vitest; dev-smoke verified).
import type { HostToSandbox, SandboxToHost } from "./protocol";
import type { SandboxTransport } from "./transport";

export async function createTauriTransport(
  label: string,
  token: string,
): Promise<SandboxTransport<SandboxToHost, HostToSandbox>> {
  const handlers = new Set<(m: SandboxToHost) => void>();
  const unlisten = await listen<SandboxToHost>(`plugin:s2h:${token}`, (e) =>
    handlers.forEach((h) => h(e.payload)),
  );
  return {
    close: () => {
      unlisten();
      handlers.clear();
    },
    onMessage: (h) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    send: (m) => void emitTo(label, `plugin:h2s:${token}`, m),
  };
}
