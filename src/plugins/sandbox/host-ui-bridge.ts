// §260 Phase 4a — the host side of `ui` for sandboxed plugins.
//
// WHY the host: the sandboxed tier gets no DOM, no CSS and no element handle — those
// are the trusted tier's `UIAPI`. What it gets is DATA the host renders on its behalf,
// which is the only form of "show something" that can be offered to code the app does
// not trust. That makes the host the place where attribution, sanitising and rate
// limiting belong: none of them can be enforced in the realm being constrained.
//
// WHY it enforces: a `plugin-*` window holds no store, no `document`, and only
// `plugin_call` + the two transport commands. This handler and `host-prompt-bridge.ts`
// (§385) are the routes from a sandbox to the screen. §394 — `ui_set_panel` is the third route here:
// a declared panel's content, taken at most `PANEL_UPDATE_BURST` at once and then one per
// `PANEL_UPDATE_INTERVAL_MS` whatever the sandbox does, and kept as sent, unsanitized
// (`panel-contents.ts`).
import type { PluginCapability, RenderedContent } from "../types";
import type { SandboxHostRequest } from "./protocol";

import { useUIStore } from "../../stores/ui/ui";
// §260 Phase 4c — the sanitiser moved to a tier-agnostic module when the settings pane
// became the second surface rendering author-controlled text. One implementation, because
// each stripped range carries a reason that would not survive being retyped.
import { pluginSourceLabel, sanitizePluginText } from "../plugin-text";
import { usePluginUIStore } from "../plugin-ui-store";
import {
  PANEL_UPDATE_BURST,
  PANEL_UPDATE_INTERVAL_MS,
  renderedContentProblem,
} from "../rendered/limits";
import {
  setPanelContent as keepPanelContent,
  panelKey,
} from "../rendered/panel-contents";
import {
  closedPanelMessage,
  panelRateMessage,
  undeclaredPanelMessage,
} from "../rendered/panel-messages";
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
 * keep a toast on screen continuously (security review LOW-1). `TOAST_DURATION_MS` is
 * still the right constant to compare against even though §324-a added a longer
 * `TOAST_ACTION_DURATION_MS`: that one applies only to a toast carrying an `action`, and
 * this bridge has no channel for a callback, so a plugin's toast never gets it.
 * RESIDUAL, stated honestly:
 * within its allowance a plugin can still replace an app toast that is mid-display. The
 * real fix is a queue or a separate plugin slot, which is app-wide UX work.
 */
export const MIN_NOTIFY_INTERVAL_MS = 4_000;

/** A toast is one line in a small box; a status-bar slot is narrower still. */
const MAX_NOTIFY_CHARS = 200;
const MAX_STATUS_BAR_CHARS = 64;

export interface UIRequestHandlerOptions {
  /** Grants recorded at install, as the manifest declared them. */
  capabilities: readonly PluginCapability[];
  /**
   * §394 spec 0073 D14 — the panel ids this plugin declared and holds `sidebar` for; `ui_set_panel`
   * refuses any other. Default: none — every panel is refused (plan 0126 P27).
   */
  declaredPanelIds?: readonly string[];
  /** Status-bar items this plugin declared — the only ones it may address. */
  declaredStatusBarIds: readonly string[];
  /** Injectable clock for the rate-limit test (`Date.now` in production). */
  now?: () => number;
  pluginId: string;
  /** Display name for attribution; falls back to the id. */
  pluginName?: string;
  /** §394 — keep a panel's content: `false` when the panel is not open. The store's own by default. */
  setPanelContent?: (key: string, content: RenderedContent) => boolean;
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
 * a `UIAPI` at all, rather than a second policy that could drift from it. Prompts are not
 * `ui` and are not gated here (§385, `host-prompt-bridge.ts`).
 */
export function createUIRequestHandler(
  options: UIRequestHandlerOptions,
): (request: UIRequest) => Promise<unknown> {
  const {
    capabilities,
    declaredPanelIds = [],
    declaredStatusBarIds,
    now = () => Date.now(),
    pluginId,
    pluginName,
    setPanelContent = keepPanelContent,
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
  const label = pluginSourceLabel(pluginName, pluginId);
  const declared = new Set(declaredStatusBarIds);
  const panels = new Set(declaredPanelIds);
  /** plan 0126 P34 — each declared panel's acceptance bucket, by id: tokens left, and when they were counted. */
  const buckets = new Map<string, { at: number; tokens: number }>();
  /**
   * Take one of panel `id`'s tokens, or `false` when it has none. A bucket holds `PANEL_UPDATE_BURST` and
   * earns one per `PANEL_UPDATE_INTERVAL_MS` of `now()`, in whole tokens — no fractions, so the request
   * one millisecond short of an interval is refused and the one at the interval is taken, exactly. A
   * full bucket earns nothing: its count restarts from the moment it filled. `now` is a wall clock by
   * default (`Date.now`): a step back moves the count's start back with it, so the step costs at most
   * the part of an interval not yet turned into a token (re-review N3).
   */
  const takeToken = (id: string): boolean => {
    const at = now();
    const bucket = buckets.get(id);
    if (bucket === undefined) {
      buckets.set(id, { at, tokens: PANEL_UPDATE_BURST - 1 });
      return true;
    }
    if (at < bucket.at) bucket.at = at;
    const earned = Math.floor((at - bucket.at) / PANEL_UPDATE_INTERVAL_MS);
    if (earned > 0) {
      bucket.tokens = Math.min(PANEL_UPDATE_BURST, bucket.tokens + earned);
      bucket.at =
        bucket.tokens === PANEL_UPDATE_BURST
          ? at
          : bucket.at + earned * PANEL_UPDATE_INTERVAL_MS;
    }
    if (bucket.tokens === 0) return false;
    bucket.tokens -= 1;
    return true;
  };
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
      case "ui_set_panel": {
        requireCapability(["sidebar"], "setPanel");
        if (!panels.has(request.id)) {
          throw new Error(undeclaredPanelMessage("setPanel", request.id));
        }
        // plan 0126 P34 — before any work on the content: a request refused below for its content has
        // spent its token too, so over-cap frames meet this bound rather than an encoding pass each.
        if (!takeToken(request.id)) {
          throw new Error(panelRateMessage(request.id));
        }
        // §6 · plan 0126 P8 — the limits the sandbox already checked, again: this realm does not
        // trust that one. Kept as sent, unsanitized (P4).
        const content: RenderedContent =
          request.css === undefined
            ? { html: request.html }
            : { css: request.css, html: request.html };
        const problem = renderedContentProblem(content);
        if (problem !== null) throw new Error(problem);
        if (!setPanelContent(panelKey(pluginId, request.id), content)) {
          throw new Error(closedPanelMessage(request.id));
        }
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
