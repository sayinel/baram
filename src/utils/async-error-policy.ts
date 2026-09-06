// issue 265 — what happens to an async error nobody caught.
//
// main.tsx used to `preventDefault()` EVERY unhandled promise rejection and
// `console.warn` it, to keep a WKWebView teardown race from taking the window
// down. That also switched off the app's only alarm for async failures: a
// leaked listener, a rejected IPC call, a bug in a `void` promise all looked
// like nothing had happened.
//
// Two kinds now. A rejection whose reason names Tauri's event internals
// (`window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener` — the exact
// dereference in @tauri-apps/api/event.js `_unlisten`, which is gone once the
// webview is being torn down) is the known teardown noise: suppressed, as
// before. Everything else is reported — `console.error` plus any subscriber,
// so a test or a future telemetry sink can see it — and the browser default
// is prevented only in production builds, where the crash guard is wanted;
// dev and test keep native visibility.
//
// `reportCaughtError` is the explicit hand-off for best-effort paths that
// catch their own failures (ghost-text prefetch): not silence, a report.

export interface CaughtErrorReport {
  error: unknown;
  scope: string;
}

export type RejectionClass = "unexpected" | "webkit-teardown";

export interface RejectionPolicyOptions {
  /** Prevent the browser default for unexpected rejections (production). */
  isProduction: boolean;
}

type RejectionTarget = Pick<Window, "addEventListener" | "removeEventListener">;

/** The only rejection shape suppressed as teardown noise — see the header. */
const TEARDOWN_SIGNATURES = ["__TAURI_EVENT_PLUGIN_INTERNALS__"] as const;

const subscribers = new Set<(report: CaughtErrorReport) => void>();

export function classifyRejection(reason: unknown): RejectionClass {
  const text = describeReason(reason);
  return TEARDOWN_SIGNATURES.some((s) => text.includes(s))
    ? "webkit-teardown"
    : "unexpected";
}

/** A rejection reason as one line, whatever it was (Error, string, object).
 *  Never throws: a reason whose toString or JSON conversion throws is
 *  described as unprintable rather than becoming a second failure. */
export function describeReason(reason: unknown): string {
  // Everything is inside the try: `instanceof` walks the prototype chain (a
  // Proxy trap can throw), `.message` can be a throwing getter, and both
  // conversions can throw. Whatever the reason does, this returns a string.
  try {
    if (typeof reason === "string") return reason;
    if (reason instanceof Error) return String(reason.message);
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    try {
      return String(reason);
    } catch {
      return "[unprintable reason]";
    }
  }
}

/** Installs the policy on `target`. Returns the uninstall function. */
export function installUnhandledRejectionPolicy(
  target: RejectionTarget,
  options: RejectionPolicyOptions,
): () => void {
  const onRejection = (event: PromiseRejectionEvent) => {
    // The production crash guard comes FIRST, before the reason is even
    // looked at: a hostile reason must not be able to defeat it. Nothing that
    // follows may throw, but the guard must not depend on that either.
    if (options.isProduction) event.preventDefault();
    const teardown = classifyRejection(event.reason) === "webkit-teardown";
    if (teardown) event.preventDefault();
    if (teardown) {
      quietly(() =>
        console.warn(
          "[Suppressed WKWebView teardown rejection]",
          describeReason(event.reason),
        ),
      );
      return;
    }
    reportCaughtError("unhandledrejection", event.reason);
  };
  target.addEventListener("unhandledrejection", onRejection);
  return () => target.removeEventListener("unhandledrejection", onRejection);
}

/** Runs `fn`; a throw is written to the console if the console allows it,
 *  and otherwise dropped — the reporting path itself must never fail. */
function quietly(fn: () => void): void {
  try {
    fn();
  } catch (failure) {
    try {
      console.error("[async-error-policy] reporter failed", failure);
    } catch {
      // nothing left to tell
    }
  }
}

/** A caught failure that must not vanish: logged and handed to subscribers.
 *  Never throws, and a subscriber that throws is isolated from the others and
 *  from the report itself — it is NOT re-reported through the subscribers,
 *  which would recurse. */
export function reportCaughtError(scope: string, error: unknown): void {
  quietly(() => console.error(`[${scope}]`, error));
  for (const callback of subscribers) {
    quietly(() => callback({ error, scope }));
  }
}

/** Hear every reported error. Returns the unsubscribe function. */
export function subscribeToAsyncErrors(
  callback: (report: CaughtErrorReport) => void,
): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}
