// The hover label's timing and its one-pill-at-a-time rule, in one place.
//
// `Tooltip.tsx` is the React trigger; `attachTooltip` below is the same thing for chrome that
// builds its own DOM (a plain ProseMirror NodeView — see `code-block-node-view.ts`). They MUST
// share this module's state rather than each keeping its own: the warm window is a property of
// the pointer's journey across the app, and the single-pill slot is what stops a React pill and
// an imperative pill painting on top of each other. Two copies of these four bindings would be
// two independent answers to both questions.
import type { Placement } from "@floating-ui/dom";

import { computePosition, flip, offset, shift } from "@floating-ui/dom";

/** How long the pointer rests on a trigger before its label appears. */
export const SHOW_DELAY_MS = 150;

/**
 * How long after one label hides the next one opens instantly.
 *
 * Without it, sweeping down a column of icons re-pays the delay at every stop, and a rail of
 * fifteen unlabeled icons stays unreadable no matter how short that delay is. With it the
 * label reads as one thing that re-titles itself as the pointer moves — which is what the
 * editors this bar is modelled on do.
 */
export const WARM_WINDOW_MS = 500;

/** Gap between the trigger and the pill. */
export const OFFSET_PX = 8;

/** What {@link attachTooltip} needs from its caller. */
export interface AttachTooltipOptions {
  /**
   * Read at every show rather than captured once: chrome built imperatively does not re-render
   * when the locale changes, so a string captured at attach time would be the language the
   * document was opened in.
   */
  label: () => string;
  placement?: Placement;
}

/**
 * When the last visible tooltip hid, shared by every trigger — see the file header.
 */
let lastHiddenAt = 0;

/**
 * The one trigger currently showing a pill, so a second one can evict it.
 *
 * Shared because the defect it fixes is inherently cross-instance: focus an icon with the
 * keyboard and then hover a different one, and the focused trigger receives neither `blur` nor
 * `pointerleave` — nothing local to it can know it should stop. Two pills then paint in the same
 * column about 44px apart, which reads as a rendering bug rather than as two labels.
 */
let currentOwner: null | { hide: () => void; token: object } = null;

/**
 * Give a label to an element that is not a React trigger, and hand back its detach.
 *
 * Everything about the timing comes from this module, so an imperative trigger behaves exactly
 * like a `<Tooltip>` one — including being evicted by, and evicting, React pills.
 */
export function attachTooltip(
  el: HTMLElement,
  { label, placement = "top" }: AttachTooltipOptions,
): () => void {
  const token = {};
  let pill: HTMLDivElement | null = null;
  let timer: null | ReturnType<typeof setTimeout> = null;
  let releasePlacement: (() => void) | null = null;
  /** See `Tooltip.tsx`'s `pressedRef`: suppresses the focus a press delivers, and only that. */
  let pressed = false;
  let pressTimer: null | ReturnType<typeof setTimeout> = null;

  const hide = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    releasePlacement?.();
    releasePlacement = null;
    if (pill) {
      stampHidden();
      pill.remove();
      pill = null;
      document.removeEventListener("keydown", onKeyDown);
    }
    releasePill(token);
  };

  const reveal = () => {
    const text = label();
    if (!text) return;
    claimPill(token, hide);
    pill = document.createElement("div");
    pill.className = "tooltip";
    pill.setAttribute("role", "tooltip");
    pill.textContent = text;
    document.body.append(pill);
    releasePlacement = placePill(el, pill, placement);
    // ‼️ Registered HERE, not at attach, and this is a performance property rather than
    // tidiness. There is one of these per code block in the document, so binding at attach
    // put N document-level keydown listeners in front of every keystroke — against a 16ms
    // typing budget, in a file that can hold hundreds of code blocks. At most one pill exists
    // at a time (the shared slot guarantees it), so at most one listener should.
    document.addEventListener("keydown", onKeyDown);
  };

  const show = () => {
    if (pressed || pill) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // The accessible name is refreshed here, not at attach: the pill is only in the DOM while
    // it shows, so without a name on the trigger an icon-only button is nameless to a screen
    // reader for all the time it is not hovered.
    const text = label();
    if (!text) return;
    el.setAttribute("aria-label", text);
    if (isWarm()) {
      reveal();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      reveal();
    }, SHOW_DELAY_MS);
  };

  // WCAG 1.4.13 Dismissible — hover content must be dismissible without moving the pointer.
  // Bound only while a pill is up; `reveal` says why.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") hide();
  };

  const onPointerDown = () => {
    pressed = true;
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      pressed = false;
    }, 0);
    hide();
  };

  el.addEventListener("pointerenter", show);
  el.addEventListener("pointerleave", hide);
  el.addEventListener("focus", show);
  el.addEventListener("blur", hide);
  el.addEventListener("pointerdown", onPointerDown);

  return () => {
    el.removeEventListener("pointerenter", show);
    el.removeEventListener("pointerleave", hide);
    el.removeEventListener("focus", show);
    el.removeEventListener("blur", hide);
    el.removeEventListener("pointerdown", onPointerDown);
    if (pressTimer !== null) clearTimeout(pressTimer);
    // `hide` takes the keydown listener with it, if this trigger had a pill up.
    hide();
  };
}

/**
 * Claim the slot at the moment a pill actually appears.
 *
 * ‼️ NOT at schedule time. Evicting the previous owner when the timer is armed would blank the
 * label the pointer is leaving 150ms before the next one arrives — a flash of nothing on every
 * cold move, which is the exact feeling {@link WARM_WINDOW_MS} exists to remove.
 */
export function claimPill(token: object, hide: () => void): void {
  if (currentOwner && currentOwner.token !== token) currentOwner.hide();
  currentOwner = { hide, token };
}

/** Whether a label may open with no delay because another one just closed. */
export function isWarm(): boolean {
  return Date.now() - lastHiddenAt < WARM_WINDOW_MS;
}

/**
 * Put the pill where floating-ui says, and fade it in. Returns a cancel for the pending
 * measurement — a trigger can stop showing before the promise lands.
 *
 * The fade lives here rather than in CSS because the pill starts transparent at the origin, so
 * a frame at (0, 0) is never painted and the same property that hides it fades it in.
 */
export function placePill(
  trigger: HTMLElement,
  floating: HTMLElement,
  placement: Placement,
): () => void {
  let cancelled = false;
  void computePosition(trigger, floating, {
    middleware: [offset(OFFSET_PX), flip(), shift({ padding: OFFSET_PX })],
    placement,
    // Must match `position: fixed` in tooltip.css. Left at the default "absolute", floating-ui
    // resolves the offset parent to the window and ADDS window scroll to the result — inert
    // only while base.css keeps html/body/#root at overflow: hidden.
    strategy: "fixed",
  }).then(({ x, y }) => {
    if (cancelled || !floating.isConnected) return;
    floating.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    floating.style.opacity = "1";
  });
  return () => {
    cancelled = true;
  };
}

/**
 * ‼️ Compare-and-clear, never an unconditional clear. An earlier trigger's late hide (Escape,
 * a delayed blur, an unmount) would otherwise wipe the NEWER owner's slot, after which the next
 * show evicts nobody and two pills are back — intermittently, which is the worst version.
 */
export function releasePill(token: object): void {
  if (currentOwner?.token === token) currentOwner = null;
}

/**
 * Start the warm window. Called only when a pill that was actually VISIBLE goes away — a hover
 * that left before the delay elapsed must leave the next trigger cold.
 */
export function stampHidden(): void {
  lastHiddenAt = Date.now();
}
