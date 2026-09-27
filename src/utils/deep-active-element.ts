// §385 The innermost active element, descending through any open shadow root.
//
// A trusted plugin panel mounts inside an open shadow root (`PluginShadowMount.tsx`), so an
// element focused there — an iframe, a plugin prompt's own input — reports the shadow HOST,
// not itself, as `document.activeElement`. Shared by the prompt gate (spec 0061 §5.3
// condition 4, which needs to see past the host to tell whether focus is inside a frame) and
// the prompt window's focus hand-back (spec 0061 §8, which needs the real element to give
// focus BACK to, not the host it is nested under).

/** The innermost active element, descending through any open shadow root. */
export function deepActiveElement(): Element | null {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}
