// §394 spec 0073 D11 — the host receives and judges clicks inside a rendered block. `click` and
// `auxclick` alike (a middle click must not open a window either), from real user input only.
// Three paths: `data-note` (open a note, ②), `data-action` (the plugin's handler, ③ — the second
// entrance of prompt rights, `src/plugins/plugin-action.ts` from plan 0125 Task 6), `<a href>`
// (①). There are no form inputs to judge — the sanitizer removed them.
//
// Which press routes (plan 0125 Task 5 ruling): a primary-button `click` takes all three paths; a
// middle-button `auxclick` opens — a note or a link — and runs no action, as a middle click on a
// button does nothing; any other `auxclick` routes nothing. A right-click fires one (button 2,
// after `contextmenu` — measured in Chrome 155 with CDP-dispatched input, whether or not
// `contextmenu` was prevented; WebKit is not measured), and UI Events fires one for every
// non-primary button. Every press on a host-owned element has its default prevented, routed or
// not.
//
// Drags (plan 0125 final review I1): plugin output is never a drag source — its `dragstart` is prevented —
// and a drag event in the shadow tree is the host's (`hostOwnsPointerEvent`). A code block is not
// `draggable`, so ProseMirror given such a `dragstart` drags the editor's selection, which may be
// text elsewhere in the note, and a drop moves it.

import { isAllowedLinkHref } from "../../utils/link-href";
import { MAX_ACTION_CHARS } from "./limits";

/** Where a judged click goes. The NodeView supplies these (Task 10). */
export interface RenderedClickHandlers {
  /** A `data-action` value, at most `MAX_ACTION_CHARS` long. */
  action(name: string): void;
  /** An absolute href the link policy allows. */
  link(href: string): void;
  /** A `data-note` value, as written — Rust judges it (`plugin_note_link`). */
  note(path: string): void;
}

const XLINK_NS = "http://www.w3.org/1999/xlink";

/** `MouseEvent.button` of the primary button — the `click` that is routed. */
const PRIMARY_BUTTON = 0;

/** `MouseEvent.button` of the middle button — the `auxclick` that is routed. */
const MIDDLE_BUTTON = 1;

/**
 * Wire `shadow`'s clicks to `handlers`, and refuse every drag that starts in it. Returns the
 * disposer. `isUserInput` is injectable because a test cannot make a trusted event; production uses
 * `isTrusted`.
 */
export function handleRenderedClicks(
  shadow: ShadowRoot,
  handlers: RenderedClickHandlers,
  isUserInput: (event: Event) => boolean = (event) => event.isTrusted,
): () => void {
  const listener = (event: Event) => {
    const target = hostOwnedTarget(event, shadow);
    if (target === null) return;
    // Prevented whatever follows: a link in this tree never navigates the app's window, and a
    // press that is refused below must not get the browser's default either.
    event.preventDefault();
    if (!isUserInput(event) || !(event instanceof MouseEvent)) return;
    if (event.type === "click" && event.button === PRIMARY_BUTTON) {
      route(target, handlers, true);
    } else if (event.type === "auxclick" && event.button === MIDDLE_BUTTON) {
      route(target, handlers, false);
    }
  };
  const refuseDrag = (event: Event) => event.preventDefault();
  shadow.addEventListener("click", listener);
  shadow.addEventListener("auxclick", listener);
  shadow.addEventListener("dragstart", refuseDrag);
  return () => {
    shadow.removeEventListener("click", listener);
    shadow.removeEventListener("auxclick", listener);
    shadow.removeEventListener("dragstart", refuseDrag);
  };
}

/**
 * Whether a pointer event (P28) is the host's rather than ProseMirror's — what the rendered view's
 * `stopEvent` asks. A `drag*` event is the host's when its composed path crosses `shadow` (I1:
 * the output starts no drag, and ProseMirror must not take one there); any other pointer event,
 * `mousedown` included, when `hostOwnedTarget` finds an element — so a press on a link does not
 * move the selection (plan 0125 Task 10). Ask it from a listener, as `hostOwnedTarget`.
 */
export function hostOwnsPointerEvent(
  event: Event,
  shadow: ShadowRoot,
): boolean {
  if (event.type.startsWith("drag")) {
    return event.composedPath().includes(shadow);
  }
  return hostOwnedTarget(event, shadow) !== null;
}

/**
 * The element of `event`'s composed path, inside `shadow`, that makes the click the host's: the
 * nearest one carrying `data-note` or `data-action`, or an `<a>` (HTML or SVG) with an href. `null`
 * means the click is ProseMirror's (D17). The click listener and `hostOwnsPointerEvent` ask it. The
 * composed path is empty once a dispatch has ended: ask it from a listener. Only the part of the
 * path before `shadow` is read — a press whose path does not cross `shadow` (the root's own box,
 * the error line) is `null` whatever its light-DOM ancestors carry.
 */
export function hostOwnedTarget(
  event: Event,
  shadow: ShadowRoot,
): Element | null {
  const path = event.composedPath();
  const end = path.indexOf(shadow);
  if (end < 0) return null;
  for (const node of path.slice(0, end)) {
    if (!(node instanceof Element)) continue;
    if (node.hasAttribute("data-note") || node.hasAttribute("data-action")) {
      return node;
    }
    if (
      node.localName === "a" &&
      (node.hasAttribute("href") || node.hasAttributeNS(XLINK_NS, "href"))
    ) {
      return node;
    }
  }
  return null;
}

/** An href that names something on its own: it parses with no base. A fragment or a relative
 *  reference does not — the URL parser throws on it. */
function isAbsolute(href: string): boolean {
  try {
    new URL(href);
    return true;
  } catch {
    return false;
  }
}

/**
 * D11 ① ② ③ for one judged element. `data-note` wins over `href` on the same `<a>`, and
 * `data-action` wins over `href` too — with `actions` false (a middle click) such an element does
 * nothing.
 */
function route(
  target: Element,
  handlers: RenderedClickHandlers,
  actions: boolean,
): void {
  const note = target.getAttribute("data-note");
  if (note !== null) {
    handlers.note(note);
    return;
  }
  const action = target.getAttribute("data-action");
  if (action !== null) {
    if (actions && action.length > 0 && action.length <= MAX_ACTION_CHARS) {
      handlers.action(action);
    }
    return;
  }
  const href =
    target.getAttribute("href") ?? target.getAttributeNS(XLINK_NS, "href");
  if (href !== null && isAbsolute(href) && isAllowedLinkHref(href)) {
    handlers.link(href);
  }
}
