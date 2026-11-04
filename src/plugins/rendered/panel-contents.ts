// §394 spec 0073 D14 · plan 0126 P4 · P23 — what each sandboxed panel last received, as it was sent.
// The host checks a request's limits when it arrives (`host-ui-bridge.ts`) and does not sanitize here,
// so content for a panel nobody is looking at costs a string and no DOM.
//
// A panel takes content only while it is OPEN — from `openPanel` to `closePanel` or `releasePanels`.
// A request that arrives after either meets a closed panel and writes nothing. The loader stops a
// sandboxed session (`sandboxTeardown`) in two places — the rollback of a failed load
// (`rollbackSandboxLoad`) and the unload (`unloadPlugin`) — and each runs the load's disposables, among
// them the `closePanel` of every panel `registerDeclaredPanels` opened, before the stop; the rollback
// also releases (`unregisterPluginUI`) before it. So a request the session hands on between those
// disposables and the stop meets closed panels, and once stopped it hands none on
// (`SandboxSession.dispose`).
//
// Also here: each plugin's action delivery — how a panel's `data-action` click reaches the plugin
// (`panels-host.ts`). The loader sets it once the plugin's session is up (`wireSandboxPanels`, after
// `activate` resolved); the unload's disposables drop it, and the release (`releasePanels`) does too.
// So a click before the session or after the unload has nowhere to go.
//
// Not a Zustand store: a panel's content is up to 1 MiB, and a listener hears one panel alone.

import type { RenderedContent } from "../types";

/**
 * Delivers a `data-action` click on the declared panel `id`; settles when the plugin's handlers have.
 * It must settle in bounded time: the host holds the plugin's prompt rights until it does
 * (`dispatchPanelAction` passes `runPluginAction` no timeout of its own). The session's `invokeAction`
 * (`wireSandboxPanels`) is bounded by `CALL_TIMEOUT_MS`, a clock that stops while a prompt is open.
 */
export type PanelActionDelivery = (id: string, action: string) => Promise<void>;

interface OpenPanel {
  content: null | RenderedContent;
  listeners: Set<() => void>;
  seq: number;
}

const panels = new Map<string, OpenPanel>();
const deliveries = new Map<string, PanelActionDelivery>();

/** Test-only: forget every panel. */
export function __resetPanelContents(): void {
  panels.clear();
  deliveries.clear();
}

/** Stop taking content for panel `key` and drop what it holds; its listeners go with it. */
export function closePanel(key: string): void {
  panels.delete(key);
}

/** Start taking content for panel `key`, with none yet. A panel already open keeps what it holds. */
export function openPanel(key: string): void {
  if (!panels.has(key)) {
    panels.set(key, { content: null, listeners: new Set(), seq: 0 });
  }
}

/** The last content panel `key` received, numbered from 1 — or `null` before any, or when it is not open. */
export function panelContent(
  key: string,
): null | { content: RenderedContent; seq: number } {
  const panel = panels.get(key);
  return panel === undefined || panel.content === null
    ? null
    : { content: panel.content, seq: panel.seq };
}

/** `pluginId`'s action delivery: `undefined` before its session is up and after its release. */
export function panelActionDelivery(
  pluginId: string,
): PanelActionDelivery | undefined {
  return deliveries.get(pluginId);
}

/** The key of a declared panel — `${pluginId}:${id}`. */
export function panelKey(pluginId: string, id: string): string {
  return `${pluginId}:${id}`;
}

/**
 * Close every panel of `pluginId`, and drop its action delivery — the panels by the `${pluginId}:`
 * prefix, which no other plugin's key starts with (a plugin id holds no `:` — the id rule of
 * `validateManifest`). `unregisterPluginUI` runs this.
 */
export function releasePanels(pluginId: string): void {
  const prefix = `${pluginId}:`;
  for (const key of [...panels.keys()]) {
    if (key.startsWith(prefix)) panels.delete(key);
  }
  deliveries.delete(pluginId);
}

/** Set `pluginId`'s action delivery, or drop it with `null`. */
export function setPanelActions(
  pluginId: string,
  deliver: null | PanelActionDelivery,
): void {
  if (deliver === null) deliveries.delete(pluginId);
  else deliveries.set(pluginId, deliver);
}

/** Keep `content` as panel `key`'s last and tell its listeners; `false`, keeping nothing, when it is not open. */
export function setPanelContent(
  key: string,
  content: RenderedContent,
): boolean {
  const panel = panels.get(key);
  if (panel === undefined) return false;
  panel.content = content;
  panel.seq += 1;
  for (const listener of [...panel.listeners]) listener();
  return true;
}

/** Hear panel `key`'s content change. A panel that is not open has nothing to hear; the stop function then does nothing. */
export function subscribePanel(key: string, listener: () => void): () => void {
  const panel = panels.get(key);
  if (panel === undefined) return () => {};
  panel.listeners.add(listener);
  return () => {
    panel.listeners.delete(listener);
  };
}
