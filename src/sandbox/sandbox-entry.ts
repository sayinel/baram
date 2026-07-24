import { emit, listen } from "@tauri-apps/api/event";

// §260 Sandbox bootstrap — runs inside a hidden plugin WebviewWindow. Wires the
// client to a token-scoped Tauri-event transport; sandbox→host uses global
// `emit` (emitTo would target THIS window). Plugin ESM is imported HERE (the
// isolation boundary).
import type { HostToSandbox, SandboxToHost } from "../plugins/sandbox/protocol";
import type { SandboxTransport } from "../plugins/sandbox/transport";

import { startSandboxClient } from "../plugins/sandbox/sandbox-client";

const params = new URLSearchParams(location.search);
const token = params.get("token") ?? "";

const handlers = new Set<(m: HostToSandbox) => void>();
void listen<HostToSandbox>(`plugin:h2s:${token}`, (e) =>
  handlers.forEach((h) => h(e.payload)),
);
const transport: SandboxTransport<HostToSandbox, SandboxToHost> = {
  close: () => handlers.clear(),
  onMessage: (h) => {
    handlers.add(h);
    return () => handlers.delete(h);
  },
  send: (m) => void emit(`plugin:s2h:${token}`, m),
};

startSandboxClient(transport, (url) => import(/* @vite-ignore */ url));
