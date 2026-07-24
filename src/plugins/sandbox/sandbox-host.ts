import { convertFileSrc } from "@tauri-apps/api/core";

// §260 SandboxHost — lifecycle of per-plugin sandbox WebviewWindows + sessions.
// windowFactory is injectable (unit-testable); production uses a hidden
// WebviewWindow + per-session-token Tauri transport. NOT yet called by the live
// loader (Phase 3).
import type { PluginContributions } from "../types";
import type { HostToSandbox, SandboxToHost } from "./protocol";
import type { SandboxTransport } from "./transport";

import { SandboxSession } from "./sandbox-session";

export interface SandboxWindow {
  close: () => void;
  transport: SandboxTransport<SandboxToHost, HostToSandbox>;
}
export type SandboxWindowFactory = (
  label: string,
  token: string,
) => Promise<SandboxWindow> | SandboxWindow;

export class SandboxHost {
  private readonly live = new Map<
    string,
    { session: SandboxSession; window: SandboxWindow }
  >();

  constructor(
    private readonly windowFactory: SandboxWindowFactory = defaultWindowFactory,
  ) {}

  async start(
    pluginId: string,
    installPath: string,
    mainFile: string,
    declared: PluginContributions,
  ): Promise<SandboxSession> {
    const existing = this.live.get(pluginId);
    if (existing) return existing.session;
    const label = `plugin-${pluginId}`;
    // §260 — unguessable per-session token so another plugin's sandbox cannot
    // guess this session's event-channel name and inject onto it.
    const token = `${pluginId}-${crypto.randomUUID()}`;
    const window = await this.windowFactory(label, token);
    const session = new SandboxSession(window.transport);
    this.live.set(pluginId, { session, window });
    try {
      const pluginUrl = convertFileSrc(`${installPath}/${mainFile}`);
      await session.activate(pluginId, pluginUrl, declared);
      return session;
    } catch (err) {
      this.live.delete(pluginId);
      session.dispose();
      window.close();
      throw err;
    }
  }

  async stop(pluginId: string): Promise<void> {
    const entry = this.live.get(pluginId);
    if (!entry) return;
    this.live.delete(pluginId);
    entry.session.dispose();
    entry.window.close();
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.live.keys()]) await this.stop(id);
  }
}

async function defaultWindowFactory(
  label: string,
  token: string,
): Promise<SandboxWindow> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { createTauriTransport } = await import("./tauri-transport");
  const win = new WebviewWindow(label, {
    decorations: false,
    focus: false,
    skipTaskbar: true,
    url: `sandbox.html?label=${encodeURIComponent(label)}&token=${encodeURIComponent(token)}`,
    visible: false,
  });
  await new Promise<void>((resolve, reject) => {
    void win.once("tauri://created", () => resolve());
    void win.once("tauri://error", (e) => reject(new Error(String(e.payload))));
  });
  const transport = await createTauriTransport(label, token);
  return { close: () => void win.close(), transport };
}
