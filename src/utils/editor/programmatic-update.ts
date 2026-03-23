/** Flag to suppress dirty marking during programmatic editor updates (tab switch, file load) */
export const programmaticUpdateRef = { current: false };

/**
 * Mark the next editor update as programmatic (will not trigger dirty flag).
 * Uses requestAnimationFrame to clear — microtasks (Promise.resolve) clear too
 * early because ProseMirror's DOMObserver may defer update events past microtask.
 */
export function markProgrammaticUpdate(): void {
  programmaticUpdateRef.current = true;
  requestAnimationFrame(() => {
    programmaticUpdateRef.current = false;
  });
}
