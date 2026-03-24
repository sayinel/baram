/** Flag to suppress dirty marking during programmatic editor updates (tab switch, file load) */
export const programmaticUpdateRef = { current: false };

/**
 * Mark the next editor update as programmatic (will not trigger dirty flag).
 * The flag is NOT cleared by a timer — instead, the auto-save handler
 * consumes it on first encounter. This avoids all timing issues with
 * ProseMirror's DOMObserver (which defers update events via setTimeout).
 */
export function markProgrammaticUpdate(): void {
  programmaticUpdateRef.current = true;
}
