// §260 Phase 4a — the host side of `ui` for sandboxed plugins.
//
// WHY the host: the sandboxed tier gets no DOM, no CSS and no element handle — those
// are the trusted tier's `UIAPI`. What it gets is DATA the host renders on its behalf,
// which is the only form of "show something" that can be offered to code the app does
// not trust. That makes the host the place where attribution, sanitising and rate
// limiting belong: none of them can be enforced in the realm being constrained.
//
// WHY it enforces: a `plugin-*` window holds no store, no `document`, and only
// `plugin_call` + the two transport commands. This handler is the sole route from a
// sandbox to the screen.
import type { PluginCapability } from "../types";
import type { SandboxHostRequest } from "./protocol";

import { useUIStore } from "../../stores/ui/ui";
// §260 Phase 4c — the sanitiser moved to a tier-agnostic module when the settings pane
// became the second surface rendering author-controlled text. One implementation, because
// each stripped range carries a reason that would not survive being retyped.
import { sanitizePluginText } from "../plugin-text";
import { usePluginUIStore } from "../plugin-ui-store";
import { UI_CAPABILITIES } from "../types";
import { createCapabilityGate } from "./capability-gate";

/**
 * A toast replaces the previous one (`useUIStore.showToast` keeps a single slot), so an
 * unbounded plugin could keep the app's own messages off the screen. Rust's
 * `RateClass::Transport` allows a **burst of 300 and 150 frames per second**
 * (`plugin/rate_limit.rs`) — the earlier claim of "~2/s" here was simply wrong — so the
 * transport bound does nothing to stop that, hence a purpose-built one.
 *
 * Set ABOVE `TOAST_DURATION_MS` (3000, `components/editor/Toast.tsx`) so a plugin cannot
 * keep a toast on screen continuously (security review LOW-1). RESIDUAL, stated honestly:
 * within its allowance a plugin can still replace an app toast that is mid-display. The
 * real fix is a queue or a separate plugin slot, which is app-wide UX work.
 */
export const MIN_NOTIFY_INTERVAL_MS = 4_000;

/** A toast is one line in a small box; a status-bar slot is narrower still. */
const MAX_NOTIFY_CHARS = 200;
const MAX_STATUS_BAR_CHARS = 64;
/** Attribution is a badge, not a sentence. */
const MAX_SOURCE_CHARS = 32;

export interface UIRequestHandlerOptions {
  /** Grants recorded at install, as the manifest declared them. */
  capabilities: readonly PluginCapability[];
  /** Status-bar items this plugin declared — the only ones it may address. */
  declaredStatusBarIds: readonly string[];
  /** Injectable clock for the rate-limit test (`Date.now` in production). */
  now?: () => number;
  pluginId: string;
  /** Display name for attribution; falls back to the id. */
  pluginName?: string;
  setStatusBarText?: (itemId: string, text: string) => void;
  showToast?: (
    message: string,
    type?: "error" | "info" | "warning",
    source?: string,
  ) => void;
}

type UIRequest = Extract<SandboxHostRequest, { kind: `ui_${string}` }>;

/**
 * Build the `ui` half of one sandboxed plugin's host-request handler.
 *
 * Gated on `UI_CAPABILITIES` — the same rule that decides whether a TRUSTED plugin gets
 * a `UIAPI` at all, rather than a second policy that could drift from it.
 */
export function createUIRequestHandler(
  options: UIRequestHandlerOptions,
): (request: UIRequest) => Promise<unknown> {
  const {
    capabilities,
    declaredStatusBarIds,
    now = () => Date.now(),
    pluginId,
    pluginName,
    setStatusBarText = (itemId, text) =>
      usePluginUIStore.getState().updateStatusBarItem(itemId, text),
    showToast = (message, type, source) =>
      useUIStore.getState().showToast(message, type, source),
  } = options;
  // §260 Phase 4a security review (HIGH-1) — `pluginName` is `manifest.name`, which
  // `validateManifest` only requires to be a non-empty string: a plugin can call itself
  // "Baram". So the name is NOT trusted as attribution — it is sanitised, capped, and
  // passed as the toast's `source`, which `ToastHost` renders as its own badge element
  // that the plugin's message text cannot occupy. Sanitised for the same reason as the
  // message: it is rendered, and unbounded author-controlled text with newlines or a bidi
  // override could otherwise reshape the line.
  //
  // Both branches are capped (code review R3): the fallback is the plugin id, which
  // `validateManifest` charset-checks but does NOT length-limit, and `.toast-source` had
  // no width bound — so a name that sanitises to nothing plus a 300-character id produced
  // a 300-character badge.
  const label =
    sanitizePluginText(pluginName ?? "", MAX_SOURCE_CHARS) ||
    sanitizePluginText(pluginId, MAX_SOURCE_CHARS);
  const declared = new Set(declaredStatusBarIds);
  let lastNotifyAt = -Infinity;

  const requireCapability = createCapabilityGate(pluginId, capabilities, "ui");

  return async (request: UIRequest) => {
    switch (request.kind) {
      case "ui_notify": {
        requireCapability(UI_CAPABILITIES, "showNotification");
        const at = now();
        if (at - lastNotifyAt < MIN_NOTIFY_INTERVAL_MS) {
          // Told, not dropped: a plugin that knows it was throttled can back off,
          // whereas a silent drop looks like a message the user simply missed.
          throw new Error(
            `notifications are limited to one every ${MIN_NOTIFY_INTERVAL_MS}ms`,
          );
        }
        lastNotifyAt = at;
        showToast(
          sanitizePluginText(request.message, MAX_NOTIFY_CHARS),
          request.type,
          label,
        );
        return undefined;
      }
      case "ui_status_bar": {
        requireCapability(["statusbar"], "setStatusBarText");
        if (!declared.has(request.id)) {
          throw new Error(
            `status-bar item "${request.id}" is not declared in contributions.statusBar`,
          );
        }
        setStatusBarText(
          statusBarItemId(pluginId, request.id),
          sanitizeStatusBarText(request.text),
        );
        return undefined;
      }
      default: {
        const unknown: never = request;
        throw new Error(`unsupported ui request: ${JSON.stringify(unknown)}`);
      }
    }
  };
}

/**
 * Status-bar text, safe to render. Exported because the loader registers the MANIFEST's
 * declared text through the same rule — that string is author-controlled too, and it
 * reaches the bar without any plugin code running.
 */
export function sanitizeStatusBarText(raw: string): string {
  return sanitizePluginText(raw, MAX_STATUS_BAR_CHARS);
}

/** Namespaced item id, shared with the loader's declarative registration. */
export function statusBarItemId(pluginId: string, declaredId: string): string {
  return `${pluginId}:sb:${declaredId}`;
}
