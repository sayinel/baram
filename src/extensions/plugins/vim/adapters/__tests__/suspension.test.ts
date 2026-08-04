// §298 Vim Phase 1 — suspension dispatch (design §4 pins).
//
// The load-bearing rule: the FIRST marker met walking outward wins. Both
// nestings are pinned — an island inside body content suspends, body
// content inside a marked wrapper does not.

import { describe, expect, it } from "vitest";

import { isSuspendTarget, shouldSuspendFor } from "../suspension";

function chain(...attrs: (null | string)[]): Element[] {
  // attrs are innermost-first, mirroring composedPath() order.
  const elements = attrs.map((attr) => {
    const el = document.createElement("div");
    if (attr) el.setAttribute(attr, "");
    return el;
  });
  for (let i = elements.length - 1; i > 0; i--) {
    elements[i].appendChild(elements[i - 1]);
  }
  return elements;
}

/** composedPath() is only populated DURING dispatch (DOM spec) — judge
 *  inside the listener, exactly where the plugin's handler runs. */
function judgeDuringDispatch(elements: Element[]): boolean {
  document.body.appendChild(elements[elements.length - 1]);
  let verdict: boolean | null = null;
  elements[elements.length - 1].addEventListener(
    "keydown",
    (e) => {
      verdict = isSuspendTarget(e);
    },
    { once: true },
  );
  elements[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
  if (verdict === null) throw new Error("event not captured");
  return verdict;
}

describe("isSuspendTarget (§4 first-marker-wins)", () => {
  it("an island inside NodeView content suspends", () => {
    const els = chain("data-vim-suspend", "data-node-view-content", null);
    expect(judgeDuringDispatch(els)).toBe(true);
  });

  it("body content inside a marked wrapper stays vim's", () => {
    const els = chain(null, "data-node-view-content", "data-vim-suspend");
    expect(judgeDuringDispatch(els)).toBe(false);
  });

  it("no marker anywhere → not suspended", () => {
    const els = chain(null, null);
    expect(judgeDuringDispatch(els)).toBe(false);
  });
});

describe("shouldSuspendFor (microtask re-evaluation)", () => {
  it("follows the same first-marker rule from the focused element", () => {
    const [inner] = chain("data-vim-suspend", "data-node-view-content");
    expect(shouldSuspendFor(inner)).toBe(true);
    const [body] = chain(null, "data-node-view-content", "data-vim-suspend");
    expect(shouldSuspendFor(body)).toBe(false);
  });

  it("focus outside the document never suspends", () => {
    expect(shouldSuspendFor(null)).toBe(false);
  });

  it("escapes a shadow root through its marked host", () => {
    const host = document.createElement("div");
    host.setAttribute("data-vim-suspend", "");
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("input");
    root.appendChild(inner);
    expect(shouldSuspendFor(inner)).toBe(true);
  });
});
