// §359 — a screen an installed theme must not be able to disguise, moved behind a
// shadow boundary.
//
// ── What the boundary buys, and what it does not ─────────────────────────────
//
// DISGUISE is what it stops. A document stylesheet does not match elements inside a
// shadow tree, so a theme rule like `.plugin-consent__title::after { content: "this
// plugin is safe" }` never reaches the node it names. This repo had already measured
// that wall from the other side: `PluginShadowMount.tsx:31-32` records that a trusted
// plugin's `addStyle()` — light DOM, `document.head` — "never reaches shadow content".
// Theme CSS arrives the same way: `theme-vars.ts:131` appends it to `head`.
//
// ‼️ That is a claim about the browser, not about our code, and our suite cannot
// re-confirm it — jsdom 30.0.1 does NOT implement the boundary for style matching
// (measured: a document rule's colour computes straight through into shadow content).
// So the tests here assert the ISOLATION MECHANISM is attached — the node is absent
// from the light DOM and present inside `host.shadowRoot` — and nothing about what a
// real browser then paints.
//
// HIDING is what it does not stop. The host element stays in the light DOM. Whatever
// is inside, `display: none` on the host or on any ancestor removes the subtree. So
// the host is pinned separately, in `security-surface-host.css`, and the two tiers
// below say how far that pinning has to go.
//
// INHERITANCE crosses the boundary regardless: custom properties are inherited, so a
// theme's colour tokens on `<html>` reach inside. That is intended — a security
// surface that ignored the user's theme would look broken, not trustworthy.
//
// ── Why the three surfaces are not treated alike ─────────────────────────────
//
// `SECURITY_SURFACE_FILES` (`src/utils/security-surfaces.ts`) names three screens, and
// what each one costs when it is hidden is different, so what each one pays for that
// protection is different too. Highest cost first:
//
//  - PluginConsentDialog — HIGHEST, `variant="overlay"`. Hidden, the user grants
//    capabilities to third-party code WITHOUT SEEING THE REQUEST. It is portaled to
//    `document.body`, so its ancestor chain is `body > host` and the app owns both
//    links of it. The portal is also what keeps the stacking context honest (see
//    `security-surface-host.css`): shadow content is subject to its host's stacking
//    position, so a host buried in the React tree can be trapped under any ancestor
//    that establishes a context — which would leave the dialog taking keystrokes while
//    invisible, the exact failure §323 hit with the suggestion menus, and
//    indistinguishable from the hiding this file exists to stop. The price is that the
//    dialog no longer sits inside the marketplace's DOM; nothing it does depends on
//    that, because it is a fixed-position modal already.
//
//  - ApprovedRootsSection — MIDDLE, `variant="inline"`. Hidden, the user cannot see or
//    withdraw a vault approval — a real loss of control, but not a silent grant: they
//    navigated to this settings screen on purpose and a section that is simply missing
//    is noticeable. It is also meaningful only among its sibling sections, so it stays
//    in place. The price: an ancestor in the settings tree that a theme can hide takes
//    this section with it, and the host pin does not reach that far.
//
//  - PluginRevokedNotice — LOWEST, `variant="inline"`. Hidden, the user loses
//    INFORMATION, not control: `usePluginActions.ts:183,329` computes the block from
//    `revocationFor` and refuses the install in code, so a hidden notice cannot turn
//    into an unwanted install. Portaling it would cost more than it buys — the notice
//    means "this row's plugin", and moved to `document.body` it loses the row it is
//    about. Same price as above: an ancestor of the row that a theme can hide takes the
//    notice with it.
//
// The marketplace's revocation BADGE (`PluginCard.tsx`) is deliberately NOT here. It
// calls none of the scanned effects, the install block behind it is the code path just
// named, and the marketplace body is a screen themes are supposed to be able to paint.
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ShadowIsolatedProps {
  children: ReactNode;
  /**
   * CSS injected into the shadow root. Required, not optional: the boundary that keeps
   * a theme out keeps the app's own stylesheets out too, so a surface with no styles
   * passed would render unstyled rather than merely unprotected.
   */
  styles: string;
  /**
   * Which tier of the file header this surface is. `"overlay"` portals the host to
   * `document.body`; `"inline"` leaves it where the component is rendered. The two
   * host classes differ in more than position, so this is one prop rather than a
   * `portal` boolean beside a free-form class name — a caller cannot pair the inline
   * host rules with a body portal, or the overlay rules with an in-tree host.
   */
  variant: "inline" | "overlay";
}

/** Marks the light-DOM host. `security-surface-host.css` pins its geometry. */
export const SECURITY_SURFACE_HOST_CLASS = "security-surface-host";

export function ShadowIsolated({
  children,
  styles,
  variant,
}: ShadowIsolatedProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // The element React renders INTO, which is a <div> inside the shadow root rather
  // than the ShadowRoot itself: `createPortal` needs an Element, and a ShadowRoot is
  // a DocumentFragment. `PluginShadowMount.tsx:29-30` reached the same wall for the
  // imperative plugin case and records its own reason.
  const [content, setContent] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // attachShadow throws if already attached (Strict-Mode remount reuses the node) —
    // same guard as PluginShadowMount.tsx:25.
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = styles;
    const el = document.createElement("div");
    el.className = "security-surface-content";
    shadow.append(sheet, el);
    setContent(el);
    return () => {
      // Both are removed, not just the content: a Strict-Mode remount re-runs this
      // effect on the SAME host, whose shadow root persists, so a <style> left behind
      // would accumulate one copy per remount.
      sheet.remove();
      el.remove();
      setContent(null);
    };
  }, [styles]);

  const host = (
    <div
      className={
        variant === "overlay"
          ? `${SECURITY_SURFACE_HOST_CLASS} ${SECURITY_SURFACE_HOST_CLASS}--overlay`
          : SECURITY_SURFACE_HOST_CLASS
      }
      ref={hostRef}
    />
  );

  return (
    <>
      {variant === "overlay" ? createPortal(host, document.body) : host}
      {/* Null on the first render — the shadow root does not exist until the effect
          above runs, so the children mount one commit later. */}
      {content !== null && createPortal(children, content)}
    </>
  );
}
