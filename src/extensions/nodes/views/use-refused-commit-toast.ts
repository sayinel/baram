// issue 531 — the "not saved" toast a chrome commit raises when the editor
// refuses it, and its cleanup when a retry succeeds.
//
// Shared by the mermaid and svg fullscreen editors (same close flow). The
// toast is global UI state, so a later successful commit must dismiss it —
// but only ITS OWN toast. The toast OBJECT is remembered, not its id: the
// store derives the next id from the current toast (`(toast?.id ?? 0) + 1`),
// so ids restart at 1 whenever the slot empties, and an unrelated toast shown
// after ours auto-dismissed can carry the same id. Each `showToast` creates a
// fresh object, so identity is the one comparison that cannot collide.

import { useCallback, useRef } from "react";

import type { ToastState } from "../../../stores/ui/ui";

import { useUIStore } from "../../../stores/ui/ui";

export interface RefusedCommitToast {
  /** Show the refusal and remember which toast it was. */
  announce: (message: string) => void;
  /** A commit went through: retire the refusal toast if it is still up. */
  settle: () => void;
}

export function useRefusedCommitToast(): RefusedCommitToast {
  const ownToastRef = useRef<null | ToastState>(null);

  const announce = useCallback((message: string) => {
    useUIStore.getState().showToast(message);
    ownToastRef.current = useUIStore.getState().toast;
  }, []);

  const settle = useCallback(() => {
    const own = ownToastRef.current;
    ownToastRef.current = null;
    if (own === null) return;
    const ui = useUIStore.getState();
    if (ui.toast === own) ui.dismissToast();
  }, []);

  return { announce, settle };
}
