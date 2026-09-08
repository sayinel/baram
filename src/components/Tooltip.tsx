// The app's own hover label, in place of the native `title` attribute.
//
// `title` puts the right words on screen, but the browser owns all three things that decide
// whether they are useful: the delay (about a second on WebKit), the placement, and the look.
// On an icon-only rail the delay is the whole problem — by the time the label arrives the
// pointer has usually moved on. This owns the timing and the pill; the words stay in i18n.
//
// The timing itself lives in `tooltip-core.ts`, shared with the imperative `attachTooltip` —
// see that file's header for why sharing is not optional.
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

import {
  claimPill,
  isWarm,
  placePill,
  releasePill,
  SHOW_DELAY_MS,
  stampHidden,
} from "./tooltip-core";

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
   *
   * May be empty, and empty is a real state rather than a caller mistake: a settings field
   * holds a path that has not been chosen yet. An empty label shows no pill and leaves the
   * trigger's own accessible name alone.
   */
  label: string;
  placement?: Placement;
}) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  const releaseTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  /**
   * Mirrors `visible` for the shared-state writes, which must not happen inside a `setVisible`
   * updater: React double-invokes updaters under StrictMode and may evaluate them eagerly, so
   * an updater that stamps a clock or claims a slot would do it twice or at the wrong time.
   */
  const visibleRef = useRef(false);
  /** Stable identity for this instance's claim on the shared slot. */
  const tokenRef = useRef({});
  /**
   * Suppresses the focus a press delivers, and only that focus.
   *
   * A press on an activity bar icon opens a panel, and the browser hands the button focus in the
   * same task — focus being one of the two ways this opens, the label a press just dismissed
   * would reappear over the panel that press revealed. So the guard is ONE-SHOT: it is cleared on
   * the next task, by which time that focus event has been and gone.
   *
   * ‼️ It used to be cleared only by `pointerleave`, which made it outlive its purpose. On the
   * read-only path field there is no panel, and a user who clicked the field — the natural move
   * when trying to read a long path — then got no label back even after tabbing away and back
   * (§556 review M3).
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
    if (visibleRef.current) {
      visibleRef.current = false;
      stampHidden();
    }
    releasePill(tokenRef.current);
    setVisible(false);
  }, [cancelPending]);

  const reveal = useCallback(() => {
    claimPill(tokenRef.current, hide);
    visibleRef.current = true;
    setVisible(true);
  }, [hide]);

  const show = useCallback(() => {
    if (pressedRef.current || !label) return;
    cancelPending();
    if (isWarm()) {
      reveal();
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      reveal();
    }, SHOW_DELAY_MS);
  }, [cancelPending, label, reveal]);

  useEffect(
    () => () => {
      cancelPending();
      if (releaseTimerRef.current !== null) {
        clearTimeout(releaseTimerRef.current);
      }
      // A trigger can unmount with its pill up — the settings modal closing, or tasksEnabled
      // switching off.
      //
      // ‼️ What this does NOT prevent, having tried to write the test: a dead entry left here is
      // self-healing, because the next `claim` calls the dead instance's `hide` (a no-op setState
      // on an unmounted component) and that hide releases the slot before the new owner takes it.
      // So no two-pill defect is reachable through it, and no test in this file can fail without
      // this line. What it does prevent is the module holding a closure over an unmounted
      // component's refs until the next show happens — small, real, and invisible to RTL.
      releasePill(tokenRef.current);
    },
    [cancelPending],
  );

  /**
   * The label going empty has to put the pill away itself.
   *
   * `pointerleave` and `blur` cannot be relied on to do it: WKWebView does not focus a `<button>`
   * on click, so pressing Clear beside a focused path field moves neither. Without this the pill
   * is merely suppressed while `visible` stays true, and the next non-empty value paints a pill
   * beside a field nobody is hovering (§556 review M1).
   */
  useEffect(() => {
    if (!label) hide();
  }, [label, hide]);

  // WCAG 1.4.13 Dismissible — hover content must be dismissible without moving the pointer.
  //
  // The same criterion's Hoverable requirement is NOT met: `pointer-events: none` plus the gap
  // to the trigger means moving toward the pill leaves the trigger and the pill goes away. That
  // is a deliberate trade (a label that can swallow a click on the icon it describes is worse),
  // and it costs nothing here because the pill is non-interactive text that is also the
  // trigger's accessible name.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible, hide]);

  // Measured after mount, not in CSS — `placePill` explains why the fade rides along.
  useEffect(() => {
    if (!visible) return;
    const trigger = triggerRef.current;
    const floating = floatingRef.current;
    if (!trigger || !floating) return;
    return placePill(trigger, floating, placement);
  }, [visible, placement, label]);

  const childProps = children.props;
  const childRef = childProps.ref;

  const setTriggerNode = useCallback(
    (node: HTMLElement | null) => {
      triggerRef.current = node;
      assignRef(childRef, node);
    },
    [childRef],
  );

  const triggerProps: TriggerProps = {
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
      if (releaseTimerRef.current !== null) {
        clearTimeout(releaseTimerRef.current);
      }
      releaseTimerRef.current = setTimeout(() => {
        releaseTimerRef.current = null;
        pressedRef.current = false;
      }, 0);
      hide();
    },
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      childProps.onPointerEnter?.(e);
      show();
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      childProps.onPointerLeave?.(e);
      hide();
    },
    ref: setTriggerNode,
  };

  // Only set when there is a name to set. `cloneElement` assigns an explicit `undefined` over
  // the child's own value, so spelling this key unconditionally would erase the child's
  // `aria-label` whenever the label is empty.
  const accessibleName = childProps["aria-label"] ?? (label || undefined);
  if (accessibleName !== undefined) triggerProps["aria-label"] = accessibleName;

  return (
    <>
      {cloneElement(children, triggerProps)}
      {visible &&
        label &&
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
