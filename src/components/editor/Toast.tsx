// Transient toast host — renders the ui store's toast and auto-dismisses it.
// Mounted once in App.tsx.
import { useEffect } from "react";

import { useShallow } from "zustand/shallow";

import { useUIStore } from "../../stores/ui/ui";

const TOAST_DURATION_MS = 3000;

export function ToastHost() {
  const { dismissToast, toast } = useUIStore(
    useShallow((s) => ({ dismissToast: s.dismissToast, toast: s.toast })),
  );

  // Restart the timer whenever a new toast arrives (id changes).
  const toastId = toast?.id;
  useEffect(() => {
    if (toastId === undefined) return;
    const timer = setTimeout(dismissToast, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toastId, dismissToast]);

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
