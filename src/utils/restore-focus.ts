// Hand focus back to whatever a modal took it from.
//
// ‼️ A dialog that removes itself without doing this drops focus to <body>,
// and when it was opened from the editor that reads as "the caret disappeared".
// It happens on EVERY exit — cancel, Escape, Enter, or a value actually picked
// — so callers cannot paper over it by re-placing the caret on the success
// path alone.

/**
 * Focus `element` again, if it is still something focusable on the page.
 *
 * `preventScroll` mirrors what ProseMirror does for its own view: a bare
 * `focus()` scrolls the container under the caret, which PM deliberately
 * avoids (see focus-editor-view.ts).
 */
export function restoreFocus(element: Element | null): void {
  // Detached by the time we get here — a widget or NodeView that was rebuilt
  // while the dialog was open. Focusing it would be a silent no-op anyway.
  if (!(element instanceof HTMLElement) || !element.isConnected) return;
  element.focus({ preventScroll: true });
}
