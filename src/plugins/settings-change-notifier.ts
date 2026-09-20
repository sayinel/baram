// §0054 — "this plugin's settings moved", for BOTH tiers.
//
// This lived in `sandbox/host-settings-bridge.ts` and was sandbox-only, which is exactly what
// made the trusted tier's absence hard to see: the event, its debounce and its capability rule
// were all filed under `sandbox/`, while `types.ts` promised that a trusted plugin's settings
// API was "otherwise identical … so one plugin source can serve both tiers". It was not. A
// trusted plugin that copied the documented snippet got silence.
//
// What is tier-neutral is everything here: WHEN a plugin should be told (its own slice of the
// store changed), HOW OFTEN (debounced), and WHO may be told (`settings`, not `events`). What
// stays per-tier is only the delivery — a frame to a webview, or a call into this realm — which
// is why `deliver` is a bare callback.
import type { PluginCapability } from "./types";

import { usePluginStore } from "../stores/system/plugin";
import { logger } from "../utils/logger";

/**
 * How long a value must hold still before the plugin is told (§260 Phase 4c).
 *
 * A string field writes to the store on every keystroke, so an undebounced notification is
 * one frame per character — each of which makes a sandboxed plugin pull, which is a broker call
 * and a staged slot write. `RateClass::Transport` (150/s) would not break, but the work is
 * pointless: nobody wants the intermediate values of a half-typed prefix.
 *
 * The trusted tier has no broker and no staging, so the cost argument is weaker there — but the
 * TASTE argument is the same one, and a plugin that rebuilds a stylesheet per keystroke is the
 * shape this delay exists to prevent. One number, so the two tiers cannot drift into
 * behaving differently for the same edit.
 */
export const SETTINGS_NOTIFY_DEBOUNCE_MS = 250;

/**
 * The event name a plugin subscribes to.
 *
 * ‼️ Gated on `settings`, NOT on `events`, in both tiers. That was a deliberate exception when
 * only the sandbox had it — the frame carries NO PAYLOAD, so there is nothing in it to leak,
 * and an author who declared `settings` would otherwise be left wondering why their plugin
 * never updates. §0054 made it the rule rather than an exception, because the trusted tier
 * enforcing `events` for the same frame is what broke the documented portability: Bullet
 * Threading declares `["extensions", "settings"]`, and requiring `events` would have made its
 * install dialog claim it subscribes to what the user does to files — for a plugin that only
 * wants to know its own colour changed.
 *
 * In the sandboxed tier it is deliberately NOT routed through `sandbox-event-bridge`: that
 * bridge carries APP events and gates them on `events`.
 */
export const SETTINGS_CHANGED_EVENT = "settings:changed";

export interface WatchPluginSettingsOptions {
  capabilities: readonly PluginCapability[];
  /**
   * Tier-specific delivery. The sandbox sends a frame to its webview; the trusted tier calls
   * this plugin's own handlers in this realm. Throwing is tolerated and logged — see below.
   */
  deliver: () => void;
  /** Names the tier in the debug log, so a skipped notification says which path it was on. */
  label: string;
  pluginId: string;
  /** Injectable for tests; defaults to the live plugin store. */
  subscribe?: (listener: () => void) => () => void;
}

/**
 * Tell one plugin when its OWN settings change. Returns an unsubscriber.
 *
 * Only this plugin's slice is watched, so one plugin's edit does not wake every other plugin.
 * A plugin without the `settings` capability is not subscribed at all rather than
 * subscribed-and-skipped: it cannot read the values, so the notification would be an invitation
 * to call something that refuses.
 */
export function watchPluginSettings(
  options: WatchPluginSettingsOptions,
): () => void {
  const { capabilities, deliver, label, pluginId } = options;
  if (!capabilities.includes("settings")) return () => undefined;
  const subscribe = options.subscribe ?? liveSubscribe(pluginId);
  let timer: null | ReturnType<typeof setTimeout> = null;
  const stop = subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        deliver();
      } catch (err) {
        // A closed session is the ordinary case for a debounce that outlived an unload by
        // less than its delay; nothing here is worth failing a store update over.
        //
        // ‼️ This does NOT catch a trusted plugin's throwing handler, and an earlier version
        // of this comment claimed it did (§0054 code review, LOW). The trusted `deliver` is
        // `emitScopedPluginEvent`, which catches and logs every handler throw itself — its
        // own doc says the caller may treat it as non-throwing — so nothing from plugin code
        // reaches here. Kept because `deliver` is a seam any tier may fill.
        logger.debug(`[${label}] ${pluginId}: settings notify skipped`, err);
      }
    }, SETTINGS_NOTIFY_DEBOUNCE_MS);
  });
  return () => {
    // The pending timer goes with the subscription, or a notification lands in a session
    // the loader has already torn down.
    if (timer) clearTimeout(timer);
    timer = null;
    stop();
  };
}

function liveSubscribe(pluginId: string): (listener: () => void) => () => void {
  return (listener) =>
    usePluginStore.subscribe((state, previous) => {
      // Identity on THIS plugin's slice, not deep equality: `setPluginSetting` always
      // replaces the slice it writes, and every other store action leaves it untouched — so
      // a plugin install or a registry refresh does not wake a plugin.
      if (
        state.pluginSettings[pluginId] === previous.pluginSettings[pluginId]
      ) {
        return;
      }
      listener();
    });
}
