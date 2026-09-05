// The app's own hover label, in place of the native `title` attribute.
//
// `title` puts the right words on screen, but the browser owns all three things that decide
// whether they are useful: the delay (about a second on WebKit), the placement, and the look.
// On an icon-only rail the delay is the whole problem — by the time the label arrives the
// pointer has usually moved on. This owns the timing and the pill; the words stay in i18n.
import { cloneElement, useCallback, useEffect, useRef, useState } from "react";
import type {
  FocusEvent,
  MutableRefObject,
  PointerEvent,
  ReactElement,
  Ref,
} from "react";
import { createPortal } from "react-dom";

import type { Placement } from "@floating-ui/dom";

import { computePosition, flip, offset, shift } from "@floating-ui/dom";

/** How long the pointer rests on a trigger before its label appears. */
const SHOW_DELAY_MS = 150;

/**
 * How long after one label hides the next one opens instantly.
 *
 * Without it, sweeping down a column of icons re-pays the delay at every stop, and a rail of
 * fifteen unlabeled icons stays unreadable no matter how short that delay is. With it the
 * label reads as one thing that re-titles itself as the pointer moves — which is what the
 * editors this bar is modelled on do.
 */
const WARM_WINDOW_MS = 500;

/** Gap between the trigger and the pill. */
const OFFSET_PX = 8;

/**
 * When the last visible tooltip hid, shared by every instance — the warm window is a property
 * of the pointer's journey across the app, not of one trigger.
 */
let lastHiddenAt = 0;

/** Props {@link Tooltip} sets on its child. Composed with the child's own, never replacing them. */
interface TriggerProps {
  "aria-label"?: string;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  ref?: Ref<HTMLElement>;
}

export function Tooltip({
  children,
  label,
  placement = "right",
}: {
  children: ReactElement<TriggerProps>;
  /**
   * Also becomes the trigger's accessible name, because the pill itself is only in the DOM
   * while it is showing — an icon-only button would otherwise be nameless to a screen reader
   * for all the time it is not hovered.
   */
  label: string;
  placement?: Placement;
}) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  /**
   * Set between a press and the pointer leaving. A press hands the trigger focus, and focus is
   * one of the two ways this opens — so without this the label a press just dismissed would
   * reappear immediately, over the panel that press opened.
   */
  const pressedRef = useRef(false);

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    cancelPending();
    setVisible((wasVisible) => {
      if (wasVisible) lastHiddenAt = Date.now();
      return false;
    });
  }, [cancelPending]);

  const show = useCallback(() => {
    if (pressedRef.current) return;
    cancelPending();
    if (Date.now() - lastHiddenAt < WARM_WINDOW_MS) {
      setVisible(true);
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setVisible(true);
    }, SHOW_DELAY_MS);
  }, [cancelPending]);

  useEffect(() => cancelPending, [cancelPending]);

  // WCAG 1.4.13 — hover content must be dismissible without moving the pointer.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible, hide]);

  // Placed after mount rather than in CSS: the pill starts transparent at the origin, so a
  // frame at (0, 0) is never painted, and the same property that hides it fades it in.
  useEffect(() => {
    if (!visible) return;
    const trigger = triggerRef.current;
    const floating = floatingRef.current;
    if (!trigger || !floating) return;

    let cancelled = false;
    void computePosition(trigger, floating, {
      middleware: [offset(OFFSET_PX), flip(), shift({ padding: OFFSET_PX })],
      placement,
    }).then(({ x, y }) => {
      if (cancelled || !floatingRef.current) return;
      floatingRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      floatingRef.current.style.opacity = "1";
    });
    return () => {
      cancelled = true;
    };
  }, [visible, placement, label]);

  const childProps = children.props;

  // A trigger with nothing to say is left exactly as it was — no pill, and no accessible
  // name overwritten with the empty string. Callers pass a value that is only sometimes
  // present (a path that has not been chosen yet), and branching at every call site would
  // mean conditionally rendering a component, which changes the child's identity.
  if (!label) return children;

  const trigger = cloneElement(children, {
    "aria-label": childProps["aria-label"] ?? label,
    onBlur: (e: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(e);
      show();
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      childProps.onPointerDown?.(e);
      pressedRef.current = true;
      hide();
    },
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      childProps.onPointerEnter?.(e);
      show();
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      childProps.onPointerLeave?.(e);
      pressedRef.current = false;
      hide();
    },
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      assignRef(childProps.ref, node);
    },
  });

  return (
    <>
      {trigger}
      {visible &&
        createPortal(
          <div className="tooltip" ref={floatingRef} role="tooltip">
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Fill whichever of the two ref shapes React handed us. */
function assignRef(
  ref: Ref<HTMLElement> | undefined,
  node: HTMLElement | null,
) {
  if (typeof ref === "function") ref(node);
  else if (ref) (ref as MutableRefObject<HTMLElement | null>).current = node;
}
