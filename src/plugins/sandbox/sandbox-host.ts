// §260 SandboxHost — lifecycle of per-plugin sandbox WebviewWindows + sessions.
// windowFactory is injectable (unit-testable); production uses a hidden
// WebviewWindow whose transport is the Phase-3c-2a per-webview IPC channel
// (commands, not events — a plugin-* window holds no event permission, so there
// is no session token to keep secret any more).
import type { PluginContributions } from "../types";
import type { HostToSandbox, SandboxToHost } from "./protocol";
import type { HostRequestHandler } from "./sandbox-session";
import type { SandboxTransport } from "./transport";

import { SandboxSession } from "./sandbox-session";

export interface SandboxWindow {
  /**
   * §260 3c-2a re-review (N1) — may return a promise, and `stop()` awaits it. The
   * real `WebviewWindow.close()` is async; discarding it made `stop()` resolve
   * before the webview was gone, so a fast reload could still collide on the
   * `plugin-<id>` label — the exact ordering the loader's teardown claims to give.
   */
  close: () => Promise<void> | void;
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

  /**
   * §260 3c-2b — no install path or entry file: the sandbox pulls its own bundle
   * through the broker, where Rust resolves the directory from the caller's window
   * label. The host never hands over a path, so there is nothing to point elsewhere.
   */
  async start(
    pluginId: string,
    declared: PluginContributions,
    /**
     * §260 3c-2c — host-mediated services for this plugin (`ai`). Passed through
     * rather than built here: the capability check and the policy belong to the
     * caller that holds the manifest (`plugin-loader`), and this class stays a
     * lifecycle manager with no knowledge of what a service does.
     */
    hostRequestHandler?: HostRequestHandler,
  ): Promise<SandboxSession> {
    const existing = this.live.get(pluginId);
    if (existing) return existing.session;
    const label = `plugin-${pluginId}`;
    const window = await this.windowFactory(label, pluginId);
    const session = new SandboxSession(window.transport, hostRequestHandler);
    this.live.set(pluginId, { session, window });
    try {
      await session.activate(pluginId, declared);
      return session;
    } catch (err) {
      this.live.delete(pluginId);
      session.dispose();
      // Awaited for the same reason as `stop()`: the label must be free before the
      // caller's rollback finishes, or a retry collides with a dying webview.
      await window.close();
      throw err;
    }
  }

  async stop(pluginId: string): Promise<void> {
    const entry = this.live.get(pluginId);
    if (!entry) return;
    this.live.delete(pluginId);
    entry.session.dispose();
    // Awaited so the `plugin-<id>` label is actually free when this resolves.
    await entry.window.close();
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
  return { close: () => win.close(), transport };
}
