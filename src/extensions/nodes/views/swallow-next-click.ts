// Shared by the two edge-drag resize hooks (use-media-resize.ts for centred
// media blocks, use-inline-resize.ts for the inline area reference).

/**
 * Cancel the single `click` the browser synthesizes right after a drag, before
 * it reaches any React handler. Registered in the capture phase on window (which
 * fires ahead of React's root listener), self-removing on the first click, with
 * a short safety timeout in case no click follows (e.g. some drags).
 *
 * Both call sites need it for the same reason from opposite directions: the
 * media blocks would select themselves into edit mode, and the block reference
 * would NAVIGATE — a drag ending with Cmd held reaches the reference's
 * Cmd/Ctrl+click handler, which is exactly the modifier it acts on.
 */
export function swallowNextClick(): void {
  const swallow = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    cleanup();
  };
  const cleanup = () => {
    window.removeEventListener("click", swallow, true);
    clearTimeout(timer);
  };
  const timer = setTimeout(cleanup, 300);
  window.addEventListener("click", swallow, true);
}
