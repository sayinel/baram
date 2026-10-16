// §394 spec 0073 D11 — clicks inside a rendered block are the host's to judge: `click` and
// `auxclick`, real user input only, three paths (`data-note`, `data-action`, `<a href>`).
import { describe, expect, it, vi } from "vitest";

import { MAX_ACTION_CHARS } from "../limits";
import { createRenderedHost, drawRendered } from "../rendered-body";
import { handleRenderedClicks, hostOwnedTarget } from "../rendered-clicks";
import { sanitizePluginMarkup } from "../sanitize-markup";

function block(html: string) {
  const { host, shadow } = createRenderedHost();
  document.body.append(host);
  drawRendered(shadow, {
    css: "",
    fragment: sanitizePluginMarkup(html).fragment,
  });
  const handlers = { action: vi.fn(), link: vi.fn(), note: vi.fn() };
  return { handlers, host, shadow };
}

/** A press of the middle button by default for `auxclick` — the one `auxclick` the host routes. */
function click(
  el: Element,
  type: "auxclick" | "click" = "click",
  button = type === "auxclick" ? 1 : 0,
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button,
    cancelable: true,
    composed: true,
  });
  el.dispatchEvent(event);
  return event;
}

/** `hostOwnedTarget`'s answer for a press on `el`, asked from a listener: an event's composed path
 *  is empty once its dispatch has ended (DOM's dispatch clears it), so asking afterwards would
 *  answer `null` for any press. */
function ownedOnPress(el: Element, shadow: ShadowRoot): Element | null {
  let owned: Element | null = null;
  const listener = (event: Event) => {
    owned = hostOwnedTarget(event, shadow);
  };
  shadow.addEventListener("mousedown", listener);
  el.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, composed: true }),
  );
  shadow.removeEventListener("mousedown", listener);
  return owned;
}

const always = () => true;

/** One element per path: a note link, an action button, an HTML link (pressed on its child) and
 *  an SVG link (likewise). */
const THREE_PATHS =
  '<a data-note="notes/a.md">a</a><button data-action="refresh">r</button>' +
  '<a href="https://e.com/x"><span>s</span></a>' +
  '<svg><a xlink:href="https://e.com/y"><text>t</text></a></svg>';

/** Press each of `THREE_PATHS`' four elements once; `true` when every press was prevented. */
function pressAll(
  shadow: ShadowRoot,
  type: "auxclick" | "click",
  button?: number,
): boolean {
  return ["[data-note]", "[data-action]", "span", "text"]
    .map((selector) => click(shadow.querySelector(selector)!, type, button))
    .every((event) => event.defaultPrevented);
}

describe("hostOwnedTarget", () => {
  /** What fails this: a walk that stops at the event's own target (the `<span>` inside the link
   *  is not the link), or one that misses an SVG link's `xlink:href`. */
  it("names the nearest data-note, data-action or linked a around the press", () => {
    const { shadow } = block(
      '<a data-note="n.md">n</a><button data-action="go"><b>g</b></button>' +
        '<a href="https://e.com/x"><span>s</span></a>' +
        '<svg><a xlink:href="https://e.com/y"><text>t</text></a></svg>',
    );
    const note = shadow.querySelector("[data-note]")!;
    const action = shadow.querySelector("[data-action]")!;
    expect(ownedOnPress(note, shadow)).toBe(note);
    expect(ownedOnPress(shadow.querySelector("b")!, shadow)).toBe(action);
    expect(ownedOnPress(shadow.querySelector("span")!, shadow)).toBe(
      shadow.querySelector("span")!.parentElement,
    );
    const text = shadow.querySelector("text")!;
    expect(ownedOnPress(text, shadow)).toBe(text.parentElement);
  });

  /** The pair of the row above: plain content, and an `<a>` with no href, are ProseMirror's. */
  it("names nothing for plain content or an a without an href", () => {
    const { shadow } = block("<p>plain</p><a>bare</a>");
    expect(ownedOnPress(shadow.querySelector("p")!, shadow)).toBeNull();
    expect(ownedOnPress(shadow.querySelector("a")!, shadow)).toBeNull();
  });
});

describe("handleRenderedClicks", () => {
  /** What fails this: routing before checking `isTrusted` — a script-built event (which a
   *  rendered block cannot make, but a trusted plugin or the app could) would open notes and run
   *  actions. The default rejects every synthetic event; jsdom can make no trusted one, so the
   *  positive rows inject the predicate. The default still prevents navigation. */
  it("routes nothing from a synthetic event by default, and still prevents its default", () => {
    const { handlers, shadow } = block('<a data-note="notes/a.md">a</a>');
    handleRenderedClicks(shadow, handlers);
    const event = click(shadow.querySelector("a")!);
    expect(event.defaultPrevented).toBe(true);
    expect(handlers.note).not.toHaveBeenCalled();
  });

  /** Three paths for one click each; the SVG link is read by its `xlink:href`. */
  it("click: data-note → note, data-action → action, an absolute allowed href → link", () => {
    const { handlers, shadow } = block(THREE_PATHS);
    handleRenderedClicks(shadow, handlers, always);
    pressAll(shadow, "click");
    expect(handlers.note.mock.calls).toEqual([["notes/a.md"]]);
    expect(handlers.action.mock.calls).toEqual([["refresh"]]);
    expect(handlers.link.mock.calls).toEqual([
      ["https://e.com/x"],
      ["https://e.com/y"],
    ]);
  });

  /** What fails this: an `auxclick` that runs `data-action` — a middle click on a button does
   *  nothing (plan 0125 Task 5 ruling). The pair of the row above for the two that open. */
  it("auxclick of the middle button: opens the note and the links, runs no action", () => {
    const { handlers, shadow } = block(THREE_PATHS);
    handleRenderedClicks(shadow, handlers, always);
    pressAll(shadow, "auxclick");
    expect(handlers.note.mock.calls).toEqual([["notes/a.md"]]);
    expect(handlers.link.mock.calls).toEqual([
      ["https://e.com/x"],
      ["https://e.com/y"],
    ]);
    expect(handlers.action).not.toHaveBeenCalled();
  });

  /** What fails this: routing every `auxclick`. A right-click fires one (button 2) after
   *  `contextmenu` — measured in Chrome 155 whether or not `contextmenu` was prevented — so it
   *  would open the link while the editor shows its own menu. A `click` not of the primary
   *  button routes nothing either. Every default is still prevented. */
  it("routes no other button's press, and prevents every one's default", () => {
    const { handlers, shadow } = block(THREE_PATHS);
    handleRenderedClicks(shadow, handlers, always);
    for (const button of [2, 3, 4]) {
      expect(pressAll(shadow, "auxclick", button)).toBe(true);
    }
    expect(pressAll(shadow, "click", 1)).toBe(true);
    expect(
      Object.values(handlers).every((h) => h.mock.calls.length === 0),
    ).toBe(true);
  });

  /** D11 ① — a fragment or a relative href resolves against nothing the plugin owns: nothing
   *  happens, but the default is still prevented (no navigation of the app's window). */
  it("does nothing for a fragment or relative href, and nothing for an over-long action", () => {
    const { handlers, shadow } = block(
      `<a href="#top">t</a><a href="notes/a.md">r</a><button data-action="${"x".repeat(MAX_ACTION_CHARS + 1)}">b</button>`,
    );
    handleRenderedClicks(shadow, handlers, always);
    for (const el of shadow.querySelectorAll("a, button")) {
      expect(click(el).defaultPrevented).toBe(true);
    }
    expect(handlers.link).not.toHaveBeenCalled();
    expect(handlers.action).not.toHaveBeenCalled();
  });

  /** What fails this: trusting the sanitizer alone. Its `<a href>` rule is the same
   *  `isAllowedLinkHref`, so a sanitized tree never holds a `file:` link — the link is put in by
   *  hand here, as any other writer of the shadow tree could. */
  it("does not open an absolute href the link policy refuses", () => {
    const { handlers, shadow } = block("");
    const link = document.createElement("a");
    link.href = "file:///etc/hosts";
    shadow.append(link);
    handleRenderedClicks(shadow, handlers, always);
    expect(click(link).defaultPrevented).toBe(true);
    expect(handlers.link).not.toHaveBeenCalled();
  });

  /** The pair of the rows above: a click on plain content is not the host's — no default is
   *  prevented, so ProseMirror gets it and selects the node (D17). */
  it("leaves a click on plain content alone", () => {
    const { handlers, shadow } = block("<p>plain</p>");
    handleRenderedClicks(shadow, handlers, always);
    const event = click(shadow.querySelector("p")!);
    expect(event.defaultPrevented).toBe(false);
    expect(
      Object.values(handlers).every((h) => h.mock.calls.length === 0),
    ).toBe(true);
  });

  /** The disposer removes both listeners. */
  it("stops routing after dispose", () => {
    const { handlers, shadow } = block('<a data-note="n.md">n</a>');
    handleRenderedClicks(shadow, handlers, always)();
    click(shadow.querySelector("a")!);
    click(shadow.querySelector("a")!, "auxclick");
    expect(handlers.note).not.toHaveBeenCalled();
  });
});
