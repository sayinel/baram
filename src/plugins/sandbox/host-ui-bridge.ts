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
import { usePluginUIStore } from "../plugin-ui-store";
import { UI_CAPABILITIES } from "../types";

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
  const label =
    sanitizePluginText(pluginName ?? "", MAX_SOURCE_CHARS) || pluginId;
  const granted = new Set(capabilities);
  const declared = new Set(declaredStatusBarIds);
  let lastNotifyAt = -Infinity;

  const requireCapability = (
    accepted: readonly PluginCapability[],
    method: string,
  ) => {
    if (accepted.some((c) => granted.has(c))) return;
    throw new Error(
      `Plugin ${pluginId} requires one of ${accepted.map((c) => `"${c}"`).join(", ")} ` +
        `to call ui.${method}. Add it to the capabilities array in baram-plugin.json.`,
    );
  };

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

/**
 * Make plugin-supplied text safe to render as a single line.
 *
 * Control characters go first: a newline in a status-bar item breaks the bar's layout,
 * and a bidi override can reorder what the user reads. Truncation happens on the
 * stripped string so the cap describes what is actually shown.
 */
function sanitizePluginText(raw: string, max: number): string {
  const flattened = raw
    // C0 + DEL + C1, plus U+2028/U+2029 — those are LINE and PARAGRAPH SEPARATOR, which
    // CSS treats as forced breaks (security review LOW-2), so without them the stated
    // "a newline breaks the status bar's layout" was still reachable.
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    // Invisible formatting: bidi overrides/isolates that could rewrite the reading order
    // of a line, plus the zero-width and BOM characters that pad a string invisibly past
    // the length cap.
    // U+200C ZWNJ and U+200D ZWJ are deliberately NOT stripped (§260 Phase 4a security
    // re-review, LOW-2): they carry no reordering power, they are orthographically
    // required in Persian/Arabic and Indic scripts, and ZWJ is what joins emoji
    // sequences — removing it split 👨‍💻 into two glyphs, in a tier whose status-bar text
    // is emoji-first. Korean/CJK were never affected: no Hangul, jamo, kana or ideograph
    // falls in any stripped range.
    .replace(
      /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g,
      "",
    )
    .trim();
  return flattened.length > max
    ? `${flattened.slice(0, max - 1)}\u2026`
    : flattened;
}
