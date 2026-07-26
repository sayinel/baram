import { convertFileSrc } from "@tauri-apps/api/core";

// §260 SandboxHost — lifecycle of per-plugin sandbox WebviewWindows + sessions.
// windowFactory is injectable (unit-testable); production uses a hidden
// WebviewWindow whose transport is the Phase-3c-2a per-webview IPC channel
// (commands, not events — a plugin-* window holds no event permission, so there
// is no session token to keep secret any more).
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
  pluginId: string,
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
    const window = await this.windowFactory(label, pluginId);
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
  pluginId: string,
): Promise<SandboxWindow> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { createHostTransport } = await import("./tauri-host-transport");
  const win = new WebviewWindow(label, {
    decorations: false,
    focus: false,
    skipTaskbar: true,
    // `label` is a debugging aid only — the sandbox reads no URL params (its
    // identity is the Tauri window label, which Rust derives, never the query).
    url: `sandbox.html?label=${encodeURIComponent(label)}`,
    visible: false,
  });
  await new Promise<void>((resolve, reject) => {
    void win.once("tauri://created", () => resolve());
    void win.once("tauri://error", (e) => reject(new Error(String(e.payload))));
  });
  const transport = await createHostTransport(pluginId);
  return { close: () => void win.close(), transport };
}
