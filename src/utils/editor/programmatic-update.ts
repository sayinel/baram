/** Flag to suppress dirty marking during programmatic editor updates (tab switch, file load) */
export const programmaticUpdateRef = { current: false };

/**
 * Mark editor updates as programmatic for 500ms (will not trigger dirty flag).
 * ProseMirror's DOMObserver fires multiple deferred update events for large
 * files. 500ms covers all batches without affecting real user edits
 * (users don't start typing within 500ms of opening a file).
 */
export function markProgrammaticUpdate(): void {
  programmaticUpdateRef.current = true;
  setTimeout(() => {
    programmaticUpdateRef.current = false;
  }, 500);
}
