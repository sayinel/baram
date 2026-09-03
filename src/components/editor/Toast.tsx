// Transient toast host — renders the ui store's toast and auto-dismisses it.
// Mounted once in App.tsx.
import { useEffect } from "react";

import { useShallow } from "zustand/shallow";

import { useUIStore } from "../../stores/ui/ui";

/**
 * How long a plain, purely informational toast stays up.
 *
 * ‼️ `sandbox/host-ui-bridge.ts`'s `MIN_NOTIFY_INTERVAL_MS` is deliberately set ABOVE
 * this so a sandboxed plugin cannot keep a toast on screen continuously. That bound is
 * still keyed to *this* constant and is still correct: a plugin's toast never carries an
 * `action` (the bridge has no channel for a callback), so it never gets the longer
 * duration below.
 */
export const TOAST_DURATION_MS = 3000;

/**
 * §324-a A toast that suggests an action gets longer.
 *
 * It is the only place the target note's name appears and the only `[Open]` affordance,
 * so the user has to read a name, decide, and click inside this window. At the plain
 * duration that is not enough time, and "you can see where it went and go there" becomes
 * a feature in name only.
 */
export const TOAST_ACTION_DURATION_MS = 8000;

export function ToastHost() {
  const { dismissToast, toast } = useUIStore(
    useShallow((s) => ({ dismissToast: s.dismissToast, toast: s.toast })),
  );

  // Restart the timer whenever a new toast arrives (id changes).
  const toastId = toast?.id;
  const hasAction = !!toast?.action;
  useEffect(() => {
    if (toastId === undefined) return;
    const timer = setTimeout(
      dismissToast,
      hasAction ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS,
    );
    return () => clearTimeout(timer);
  }, [toastId, hasAction, dismissToast]);

  if (!toast) return null;

  return (
    <div aria-live="polite" className="toast-host">
      <div
        className={`toast${toast.type ? ` toast-${toast.type}` : ""}`}
        role="status"
      >
        {/* §260 Phase 4a — attribution is a separate element on purpose: a sandboxed
            plugin controls `message`, so a name folded into that string would be a
            name the plugin could forge (it can still write "Baram:" INSIDE its own
            message, but not outside this badge). */}
        {toast.source ? (
          <span className="toast-source">{toast.source}</span>
        ) : null}
        {toast.message}
        {/* §324-a 행동은 앱 코드만 채운다 (`ToastState.action`). 실행한 뒤 토스트를
            같이 거두는 이유: 남아 있으면 사용자는 그것을 "아직 안 눌렸다"로 읽고 한 번
            더 누른다. */}
        {toast.action ? (
          <button
            className="btn-unstyled toast-action"
            onClick={() => {
              toast.action?.onClick();
              dismissToast();
            }}
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
