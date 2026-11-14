// §5.5 — the table toolbar follows layout that moves the table or resizes the
// toolbar with no editor selection or transaction event and no scroll, the
// events it used to be placed on alone. Such layout comes from the window or
// a side panel resizing the editor area, a density or font dial, an image
// loading above the table, a column drag.
//
// jsdom has no ResizeObserver and no layout. A fake observer stands in, and
// `fire()` does what the browser does after a layout that resized a watched
// box.
import type { Editor } from "@tiptap/core";

import { act, cleanup, waitFor } from "@testing-library/react";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getTableToolbarRect } from "../table-toolbar-rect";
import {
  cleanupEditors,
  flush,
  mountTableWithToolbar,
} from "./table-toolbar-test-helpers";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  disconnected = false;
  readonly observed = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  disconnect(): void {
    this.observed.clear();
    this.disconnected = true;
  }
  fire(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  cleanupEditors();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function box(left: number, top: number, width: number, height: number) {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** The one observer watching the editor area now — the toolbar's. */
function liveObserver(): FakeResizeObserver {
  const area = document.querySelector(".editor-area-scroll");
  const live = FakeResizeObserver.instances.filter(
    (o) => !o.disconnected && area !== null && o.observed.has(area),
  );
  expect(live).toHaveLength(1);
  return live[0];
}

/** Text position of the first text node that reads `text`. */
function posOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error(`no text node "${text}"`);
  return found;
}

/** A layout the test can change afterwards: the scroll area spans x ∈ [0, 600]
 *  and y ∈ [0, 800], and the wrapper fills it across; the table is 300 × 200
 *  at (`place.tableLeft`, `place.tableTop`). */
function movableLayout(place: { tableLeft: number; tableTop?: number }) {
  return (el: Element): DOMRect => {
    const top = place.tableTop ?? 200;
    if (el.classList.contains("editor-area-scroll")) return box(0, 0, 600, 800);
    if (el.classList.contains("tableWrapper")) return box(0, top, 600, 200);
    if (el.tagName === "TABLE") return box(place.tableLeft, top, 300, 200);
    return box(0, 0, 0, 0);
  };
}

function sizes(size: { toolbarWidth: number }) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("table-toolbar") ? size.toolbarWidth : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("table-toolbar") ? 30 : 0;
    },
  );
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(
    function (this: Element) {
      return this.classList.contains("editor-area-scroll") ? 600 : 0;
    },
  );
}

function toolbarLeft(): string {
  const toolbar = document.querySelector<HTMLElement>(".table-toolbar");
  if (!toolbar) throw new Error("table toolbar did not show");
  return toolbar.style.left;
}

describe("the table toolbar follows layout no transaction reports", () => {
  it("places itself again when the table moves with the editor area", async () => {
    // A wider window recentres a width-capped text column: the table moves
    // right by 100 with no transaction and no scroll.
    const place = { tableLeft: 0 };
    sizes({ toolbarWidth: 200 });
    await mountTableWithToolbar(movableLayout(place));
    expect(toolbarLeft()).toBe("150px");

    place.tableLeft = 100;
    act(() => liveObserver().fire());
    expect(toolbarLeft()).toBe("250px");
  });

  it("moves in again when its own size changes", async () => {
    // A density dial widens the toolbar from 236 to 300 while it shows. Over
    // a table whose middle is at 40, its left end must stay 4 inside the
    // area: 4 + 236 / 2 = 122 before, 4 + 300 / 2 = 154 after.
    const size = { toolbarWidth: 236 };
    sizes(size);
    await mountTableWithToolbar((el) =>
      el.tagName === "TABLE"
        ? box(0, 200, 80, 200)
        : movableLayout({ tableLeft: 0 })(el),
    );
    expect(toolbarLeft()).toBe("122px");

    size.toolbarWidth = 300;
    act(() => liveObserver().fire());
    expect(toolbarLeft()).toBe("154px");
  });

  it("moves on React's own pass, not inside the observer's callback", async () => {
    // A commit inside the callback could change what is watched from there,
    // which the browser holds with a "loop completed with undelivered
    // notifications" error. Outside an act() scope the DOM is read right after
    // the callback returns, then once React has run.
    const place = { tableLeft: 0 };
    sizes({ toolbarWidth: 200 });
    await mountTableWithToolbar(movableLayout(place));
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const actEnvironment = scope.IS_REACT_ACT_ENVIRONMENT;
    scope.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      place.tableLeft = 100;
      liveObserver().fire();
      await Promise.resolve();
      expect(toolbarLeft()).toBe("150px");
      await waitFor(() => expect(toolbarLeft()).toBe("250px"));
    } finally {
      scope.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }
  });

  it("shows itself again when layout brings its table back into view", async () => {
    // A narrower window wraps the text above and pushes the table below the
    // area; widening it brings the table back. No key, click or scroll.
    const place = { tableLeft: 0, tableTop: 200 };
    sizes({ toolbarWidth: 200 });
    await mountTableWithToolbar(movableLayout(place));
    expect(toolbarLeft()).toBe("150px");

    place.tableTop = 900;
    act(() => liveObserver().fire());
    expect(document.querySelector(".table-toolbar")).toBeNull();

    place.tableTop = 200;
    act(() => liveObserver().fire());
    expect(toolbarLeft()).toBe("150px");
  });

  it("shows itself again on React's own pass, not inside the callback", async () => {
    // A toolbar that mounts inside the callback is watched from there, and it
    // is shallower than the document and the table that reported: the
    // browser would hold that watch with a "loop completed with undelivered
    // notifications" error. So the callback returns before it is drawn.
    const place = { tableLeft: 0, tableTop: 200 };
    sizes({ toolbarWidth: 200 });
    await mountTableWithToolbar(movableLayout(place));
    place.tableTop = 900;
    act(() => liveObserver().fire());
    expect(document.querySelector(".table-toolbar")).toBeNull();

    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const actEnvironment = scope.IS_REACT_ACT_ENVIRONMENT;
    scope.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      place.tableTop = 200;
      liveObserver().fire();
      await Promise.resolve();
      expect(document.querySelector(".table-toolbar")).toBeNull();
      await waitFor(() =>
        expect(document.querySelector(".table-toolbar")).not.toBeNull(),
      );
    } finally {
      scope.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }
  });

  it("renders nothing when nothing moved in the area, but republishes its rect", async () => {
    // Typing that widens a column resizes the table on most keystrokes, and
    // the transaction already placed the toolbar: no render. A side panel
    // opening moves the whole area right by 40 — nothing moves within it, so
    // still no render — but the rect the ⊕/grip suppression reads must follow
    // the toolbar on screen.
    const at = { shift: 0 };
    const rects = (el: Element): DOMRect => {
      if (el.classList.contains("editor-area-scroll"))
        return box(at.shift, 0, 600, 800);
      if (el.classList.contains("tableWrapper"))
        return box(at.shift, 200, 600, 200);
      if (el.tagName === "TABLE") return box(at.shift, 200, 300, 200);
      if (el.classList.contains("table-toolbar"))
        return box(at.shift + 50, 150, 200, 30);
      return box(0, 0, 0, 0);
    };
    let commits = 0;
    sizes({ toolbarWidth: 200 });
    await mountTableWithToolbar(rects, undefined, () => {
      commits++;
    });
    const before = commits;
    expect(before).toBeGreaterThan(0);
    expect(getTableToolbarRect()?.left).toBe(50);

    act(() => liveObserver().fire());
    expect(commits).toBe(before);

    at.shift = 40;
    act(() => liveObserver().fire());
    expect(commits).toBe(before);
    expect(getTableToolbarRect()?.left).toBe(90);
  });

  it("still renders on a transaction that leaves its place unchanged", async () => {
    // Widening a cell selection from one cell to two keeps the toolbar where
    // it is, over the same table, but makes the cells mergeable. The merge
    // button reads that from the editor as the toolbar renders.
    sizes({ toolbarWidth: 200 });
    const { editor } = await mountTableWithToolbar(
      movableLayout({ tableLeft: 0 }),
    );
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
      return true;
    });
    const [c, d] = cells;
    // Align left · center · right, then merge: the fourth button.
    const mergeButton = () =>
      document.querySelectorAll<HTMLButtonElement>(".table-toolbar-btn")[3];

    act(() => {
      editor.view.dispatch(
        editor.state.tr.setSelection(CellSelection.create(editor.state.doc, c)),
      );
    });
    await flush();
    expect(mergeButton().disabled).toBe(true);

    act(() => {
      editor.view.dispatch(
        editor.state.tr.setSelection(
          CellSelection.create(editor.state.doc, c, d),
        ),
      );
    });
    await flush();
    expect(mergeButton().disabled).toBe(false);
  });

  it("watches the editor area, the document, the table and itself", async () => {
    sizes({ toolbarWidth: 200 });
    const { editor } = await mountTableWithToolbar(
      movableLayout({ tableLeft: 0 }),
    );
    const watched = liveObserver().observed;
    expect(watched.has(document.querySelector(".editor-area-scroll")!)).toBe(
      true,
    );
    expect(watched.has(editor.view.dom)).toBe(true);
    expect(watched.has(document.querySelector("table")!)).toBe(true);
    expect(watched.has(document.querySelector(".table-toolbar")!)).toBe(true);
  });

  it("follows the caret to another table and stops watching when it leaves", async () => {
    sizes({ toolbarWidth: 200 });
    const { editor } = await mountTableWithToolbar(
      movableLayout({ tableLeft: 0 }),
      "| a | b |\n| --- | --- |\n| c | d |\n\nbetween\n\n| e | f |\n| --- | --- |\n| g | h |\n",
    );
    const [first, second] = Array.from(document.querySelectorAll("table"));
    expect(liveObserver().observed.has(first)).toBe(true);

    act(() => {
      editor.commands.setTextSelection(posOf(editor, "g") + 1);
    });
    await flush();
    expect(liveObserver().observed.has(second)).toBe(true);
    expect(liveObserver().observed.has(first)).toBe(false);
    expect(
      liveObserver().observed.has(document.querySelector(".table-toolbar")!),
    ).toBe(true);
    const watching = liveObserver();

    act(() => {
      editor.commands.setTextSelection(posOf(editor, "between") + 1);
    });
    await flush();
    expect(document.querySelector(".table-toolbar")).toBeNull();
    expect(watching.disconnected).toBe(true);
    const area = document.querySelector(".editor-area-scroll")!;
    expect(
      FakeResizeObserver.instances.filter(
        (o) => !o.disconnected && o.observed.has(area),
      ),
    ).toHaveLength(0);
  });

  it("renders nothing on a scroll that leaves its place unchanged", async () => {
    // Scrolling a tall table with the toolbar pinned to the top keeps it
    // where it is; a scroll does not change what the buttons read.
    let commits = 0;
    sizes({ toolbarWidth: 200 });
    await mountTableWithToolbar(
      movableLayout({ tableLeft: 0 }),
      undefined,
      () => {
        commits++;
      },
    );
    const before = commits;
    act(() => {
      document
        .querySelector(".editor-area-scroll")!
        .dispatchEvent(new Event("scroll"));
    });
    expect(commits).toBe(before);
  });

  it("commits nothing while the user types outside any table", async () => {
    // The typing hot path: every keystroke is a transaction, and with the
    // caret outside a table the toolbar has nothing to change.
    let commits = 0;
    sizes({ toolbarWidth: 200 });
    const { editor } = await mountTableWithToolbar(
      movableLayout({ tableLeft: 0 }),
      "above\n\n| a | b |\n| --- | --- |\n| c | d |\n",
      () => {
        commits++;
      },
    );
    act(() => {
      editor.commands.setTextSelection(posOf(editor, "above") + 1);
    });
    await flush();
    expect(document.querySelector(".table-toolbar")).toBeNull();
    const before = commits;

    for (const ch of "typing") {
      act(() => {
        editor.commands.insertContent(ch);
      });
    }
    await flush();
    expect(editor.state.doc.textContent.startsWith("atypingbove")).toBe(true);
    expect(commits).toBe(before);
  });

  it("commits nothing while the user types in a table scrolled out of view", async () => {
    // The toolbar hides but keeps its table for the relayout watch, so each
    // keystroke builds a new hidden placement holding that table.
    let commits = 0;
    const place = { tableLeft: 0, tableTop: 200 };
    sizes({ toolbarWidth: 200 });
    const { editor } = await mountTableWithToolbar(
      movableLayout(place),
      undefined,
      () => {
        commits++;
      },
    );
    place.tableTop = 900;
    act(() => liveObserver().fire());
    expect(document.querySelector(".table-toolbar")).toBeNull();
    const before = commits;

    for (const ch of "typing") {
      act(() => {
        editor.commands.insertContent(ch);
      });
    }
    await flush();
    expect(editor.state.doc.textContent).toContain("typing");
    expect(commits).toBe(before);
  });
});
