// `attachTooltip` — the hover label for chrome that builds its own DOM.
//
// The code block's ✨ button is a plain ProseMirror NodeView (CodeMirror lives inside it), so
// there is no React element for `<Tooltip>` to wrap. It used to be the one block in the editor
// whose label came from a native `title`, which meant it behaved differently from every
// neighbour: ~1s late, in the browser's box, and — the part no screenshot shows — with its own
// idea of whether a label is already open.
//
// ‼️ That last part is what most of this file is about. The delay, the warm window and the
// one-pill slot live in `tooltip-core.ts` and are MODULE state, shared with the React
// component on purpose. Two copies would be two answers to "is a label already showing", and
// the visible result is two pills at once as the pointer crosses from a React trigger to this
// one. So the cross-mechanism cases below are not thoroughness; they are the reason the core
// was extracted instead of the timing being copied.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { Tooltip } from "../Tooltip";
import { attachTooltip } from "../tooltip-core";

const detachers: Array<() => void> = [];
const owned: HTMLElement[] = [];

/** A button in the document, labelled imperatively. `label` is read at every show. */
function attach(label: () => string): HTMLButtonElement {
  const el = document.createElement("button");
  document.body.append(el);
  owned.push(el);
  detachers.push(attachTooltip(el, { label }));
  return el;
}

function pill(): HTMLElement | null {
  return screen.queryByRole("tooltip");
}

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

/**
 * The warm window is module state, so a label one test dismissed would open the next one with
 * no delay and make its "waits for the delay" assertion vacuous.
 *
 * ‼️ Jumping the clock FORWARD, and with the fake clock installed once in `beforeAll`.
 * `vi.useFakeTimers()` resets "now" to the real system time, so calling it per test sends the
 * clock backwards past a stamp an earlier test left — and a negative age reads as inside the
 * window, i.e. warm.
 */
beforeEach(() => {
  vi.setSystemTime(Date.now() + 60_000);
});

afterEach(() => {
  // ‼️ Order matters, and only in one direction. Detach first so any pill this file put up
  // goes away through the code that owns it, then let RTL unmount its own trees. Clearing
  // `document.body` wholesale instead throws `NotFoundError` out of RTL's cleanup — vitest
  // runs afterEach hooks innermost-first, so this one deletes the container React is about to
  // unmount from.
  for (const detach of detachers.splice(0)) detach();
  cleanup();
  for (const el of owned.splice(0)) el.remove();
});

describe("show delay", () => {
  it("stays hidden while the pointer has not rested long enough", () => {
    const el = attach(() => "Files");
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(140);
    });
    expect(pill()).toBeNull();
  });

  it("appears once the pointer has rested", () => {
    const el = attach(() => "Files");
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(pill()?.textContent).toBe("Files");
  });

  it("never appears when the pointer leaves before the delay elapses", () => {
    const el = attach(() => "Files");
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.pointerLeave(el);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(pill()).toBeNull();
  });
});

describe("the label is read at every show, not captured at attach", () => {
  // The one behaviour that differs from the React component by design. A plain NodeView is not
  // re-rendered when the locale changes, so a string captured when the block mounted would be
  // the language the document was OPENED in — for as long as the tab stays open.
  it("follows a label that changed since the last hover", () => {
    let label = "AI Commands";
    const el = attach(() => label);

    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(pill()?.textContent).toBe("AI Commands");
    fireEvent.pointerLeave(el);

    label = "AI 명령";
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(pill()?.textContent).toBe("AI 명령");
    // …and the accessible name moved with it, which is the half a screen reader gets.
    expect(el.getAttribute("aria-label")).toBe("AI 명령");
  });

  it("shows no pill at all for a trigger with nothing to say", () => {
    const el = attach(() => "");
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(pill()).toBeNull();
    expect(el.hasAttribute("aria-label")).toBe(false);
  });
});

describe("dismissal", () => {
  it("hides when the pointer leaves", () => {
    const el = attach(() => "Files");
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.pointerLeave(el);
    expect(pill()).toBeNull();
  });

  it("hides on Escape while it is showing", () => {
    const el = attach(() => "Files");
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(pill()).toBeNull();
  });

  it("hides on press, and the focus the press hands over does not bring it back", () => {
    // Pressing the ✨ button opens the AI menu and the browser focuses the button in the same
    // task. Focus being one of the two ways a label opens, the label the press dismissed would
    // otherwise reappear over the menu that press just revealed.
    const el = attach(() => "Files");
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.pointerDown(el);
    fireEvent.focus(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(pill()).toBeNull();
  });

  it("lets a later focus open the label again — the press guard is one-shot", () => {
    const el = attach(() => "Files");
    fireEvent.pointerDown(el);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    fireEvent.focus(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(pill()?.textContent).toBe("Files");
  });

  it("takes its pill and its listeners away on detach", () => {
    const el = attach(() => "Files");
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(pill()).not.toBeNull();

    detachers.splice(0).forEach((detach) => detach());
    expect(pill()).toBeNull();

    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(pill()).toBeNull();
  });
});

describe("the Escape listener is bound only while a pill is up", () => {
  // ‼️ A performance property, not tidiness. There is one `attachTooltip` per code block, so
  // binding at attach put a document-level keydown listener per block in front of every
  // keystroke — against this app's 16ms typing budget, in files that hold hundreds of code
  // blocks. The shared slot already guarantees at most one pill exists, so at most one
  // listener should. Counted, because the cost is the COUNT: an assertion that Escape works
  // passes either way.
  function countKeydown(): number {
    return added.filter(([type]) => type === "keydown").length;
  }

  type Listener = EventListenerOrEventListenerObject;
  const added: Array<[string, Listener]> = [];
  const removed: Array<[string, Listener]> = [];
  const realAdd = document.addEventListener;
  const realRemove = document.removeEventListener;

  beforeEach(() => {
    added.length = 0;
    removed.length = 0;
    // Wrapped, not replaced — the real listener still has to be installed, or the Escape
    // behaviour these counts are about would stop working and the counts would mean nothing.
    //
    // Assigned directly rather than through `vi.spyOn`: the DOM lib types
    // `document.addEventListener` as two overloads, and a mock implementation cannot satisfy
    // both without a cast that hides which one it is answering.
    document.addEventListener = ((
      type: string,
      fn: Listener,
      opts?: AddEventListenerOptions | boolean,
    ) => {
      added.push([type, fn]);
      realAdd.call(document, type, fn, opts);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((
      type: string,
      fn: Listener,
      opts?: boolean | EventListenerOptions,
    ) => {
      removed.push([type, fn]);
      realRemove.call(document, type, fn, opts);
    }) as typeof document.removeEventListener;
  });

  afterEach(() => {
    document.addEventListener = realAdd;
    document.removeEventListener = realRemove;
  });

  it("binds nothing for three idle triggers", () => {
    attach(() => "A");
    attach(() => "B");
    attach(() => "C");
    expect(countKeydown()).toBe(0);
  });

  it("binds one when a pill appears and unbinds it when the pill goes", () => {
    const el = attach(() => "A");
    fireEvent.pointerEnter(el);
    // Still nothing while the delay runs — a pending timer is not a pill.
    act(() => {
      vi.advanceTimersByTime(140);
    });
    expect(countKeydown()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(countKeydown()).toBe(1);

    fireEvent.pointerLeave(el);
    expect(removed.filter(([type]) => type === "keydown")).toHaveLength(1);
  });

  it("never holds two, even while the pill hops between triggers", () => {
    const a = attach(() => "A");
    const b = attach(() => "B");
    fireEvent.pointerEnter(a);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    // Warm, so this one appears at once and evicts the first.
    fireEvent.pointerEnter(b);
    expect(
      countKeydown() - removed.filter(([t]) => t === "keydown").length,
    ).toBe(1);
  });
});

describe("one pill at a time, across BOTH mechanisms", () => {
  it("evicts a React pill when the imperative one appears", () => {
    render(
      <Tooltip label="Search">
        <button type="button">search</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText("search"));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);

    const el = attach(() => "AI Commands");
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    // Not two, and the survivor is the one the pointer is on.
    const pills = screen.getAllByRole("tooltip");
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toBe("AI Commands");
  });

  it("is evicted BY a React pill in turn", () => {
    const el = attach(() => "AI Commands");
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);

    render(
      <Tooltip label="Search">
        <button type="button">search</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText("search"));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const pills = screen.getAllByRole("tooltip");
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toBe("Search");
  });

  it("shares the warm window, so crossing between the two opens with no delay", () => {
    // The feeling this buys: sweeping across a block's chrome reads as ONE label re-titling
    // itself. If the two mechanisms kept separate clocks, the pointer would pay the full delay
    // again at exactly the boundary between a React button and this one — which is the middle
    // of a hover toolbar.
    render(
      <Tooltip label="Search">
        <button type="button">search</button>
      </Tooltip>,
    );
    const react = screen.getByText("search");
    fireEvent.pointerEnter(react);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.pointerLeave(react);

    const el = attach(() => "AI Commands");
    fireEvent.pointerEnter(el);
    // No timer advance at all.
    expect(pill()?.textContent).toBe("AI Commands");
  });

  it("stamps that window itself, so a React trigger warms off it too", () => {
    const el = attach(() => "AI Commands");
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.pointerLeave(el);

    render(
      <Tooltip label="Search">
        <button type="button">search</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText("search"));
    expect(pill()?.textContent).toBe("Search");
  });

  it("leaves the next trigger COLD after a hover that never showed a label", () => {
    // The window is stamped by a pill going away, not by any hide. A hover that left before
    // the delay elapsed must not make the next one instant.
    const el = attach(() => "AI Commands");
    fireEvent.pointerEnter(el);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.pointerLeave(el);

    const other = attach(() => "Files");
    fireEvent.pointerEnter(other);
    expect(pill()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(pill()?.textContent).toBe("Files");
  });
});
