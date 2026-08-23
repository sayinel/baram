// §5.12 export — the wait loop, on its own.
//
// export-heavy-blocks.test.tsx drives this through a real editor, which proves
// the common case. It cannot produce the case that matters here: a document
// with more heavy blocks than one wake batch, whose renders are SLOWER than the
// stall budget. That combination is what a large document of Mermaid diagrams
// actually is, and it is where a "did anything finish?" progress rule gives up
// on work it has not even started yet.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetForTest,
  onFirstVisible,
} from "../../../extensions/nodes/views/lazy-visible";
import { pendingHeavyBlocks, settleHeavyBlocks } from "../export-heavy-blocks";

/**
 * Production waits up to 15s with nothing happening before giving up, which is
 * right for a real Mermaid render and wrong for a test suite. Only the numbers
 * change; the loop under test is the same one that ships.
 */
const FAST = { pollMs: 10, stallMs: 250 };

let root: HTMLElement;

beforeEach(() => {
  _resetForTest();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  _resetForTest();
});

/**
 * A mermaid block that reports "done" `renderMs` after it is woken — the shape
 * mermaid-block-view produces, reduced to the two things the wait loop reads.
 */
function addSlowMermaid(renderMs: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "mermaid-block";
  el.setAttribute("data-render-state", "pending");
  root.append(el);
  onFirstVisible(el, () => {
    setTimeout(() => el.setAttribute("data-render-state", "done"), renderMs);
  });
  return el;
}

describe("settleHeavyBlocks", () => {
  it("returns immediately when nothing is deferred", async () => {
    const el = document.createElement("div");
    el.className = "mermaid-block";
    el.setAttribute("data-render-state", "done");
    root.append(el);

    expect(await settleHeavyBlocks(root)).toEqual([]);
  });

  it("waits for a block whose render outlives several polls", async () => {
    const el = addSlowMermaid(150);
    expect(pendingHeavyBlocks(root)).toHaveLength(1);

    expect(await settleHeavyBlocks(root, FAST)).toEqual([]);
    expect(el.getAttribute("data-render-state")).toBe("done");
  });

  it("wakes MORE blocks than one batch holds, however slow they are", async () => {
    // ‼️ The regression, reproduced by construction. `wakeBatch: 1` over 60
    // blocks makes the WAKE PHASE (~600ms) far longer than the stall budget
    // (250ms), and a 400ms render means nothing has finished by the time that
    // budget first expires. A progress rule that counts only COMPLETIONS
    // therefore sees a flat pending count, declares a stall at ~250ms, and
    // returns having woken about 25 of 60 — the other 35 export empty. Waking
    // has to count as progress too.
    const blocks = Array.from({ length: 60 }, () => addSlowMermaid(400));

    const unsettled = await settleHeavyBlocks(root, {
      ...FAST,
      wakeBatch: 1,
    });

    expect(unsettled).toHaveLength(0);
    for (const el of blocks) {
      expect(el.getAttribute("data-render-state")).toBe("done");
    }
  }, 30_000);

  it("wakes only the document being exported, not the rest of the app", async () => {
    // ‼️ The lazy queue is APP-WIDE. Journal's photo tiles register on it too
    // (use-photo-thumb.ts), and a retained Journal tab can hold hundreds of
    // never-intersected registrations. Without a root filter the export spends
    // its wake budget on those — firing the IPC stampede the queue exists to
    // spread out — while the document's own blocks stay unmounted.
    const outsider = document.createElement("div");
    document.body.append(outsider);
    const strangerWoken = vi.fn();
    onFirstVisible(outsider, strangerWoken);

    const mine = addSlowMermaid(50);

    await settleHeavyBlocks(root, FAST);

    expect(mine.getAttribute("data-render-state")).toBe("done");
    expect(strangerWoken).not.toHaveBeenCalled();
    outsider.remove();
  }, 30_000);

  it("does not wait on an empty math block that is being edited", async () => {
    // ‼️ math-block-view writes `textContent = selected ? "" : "Empty math
    // block"`, so a SELECTED empty block leaves its KaTeX host with no children
    // forever. "Host is empty" therefore cannot mean "not rendered yet" on its
    // own. The `math-block-katex-empty` class is what the effect sets when it
    // runs and finds nothing to typeset — that is the observable difference.
    // Scenario: the caret sits in an empty `$$` and the user hits Export; every
    // export then costs the full stall budget for a block with nothing in it.
    const block = document.createElement("div");
    block.className = "math-block math-block-editing";
    block.innerHTML =
      '<div class="math-block-katex math-block-katex-empty"></div>';
    root.append(block);

    const started = Date.now();
    expect(await settleHeavyBlocks(root, FAST)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(FAST.stallMs);
  });

  it("gives up on a block that never finishes, and names it", async () => {
    const stuck = document.createElement("div");
    stuck.className = "mermaid-block";
    stuck.setAttribute("data-render-state", "pending");
    root.append(stuck);
    onFirstVisible(stuck, () => {
      /* woken, and never reports done */
    });

    const unsettled = await settleHeavyBlocks(root, FAST);

    expect(unsettled).toHaveLength(1);
    expect(unsettled[0].kind).toBe("mermaid");
    expect(unsettled[0].el).toBe(stuck);
  }, 30_000);

  it("does not let one block's failure to mount abandon the others", async () => {
    // ‼️ The callbacks run in a loop. An exception from one used to abort that
    // loop, and because the entries are removed from the observer before they
    // are invoked, every block after the thrower was dropped for good — the
    // export would then wait out the stall budget and print them empty.
    const thrower = document.createElement("div");
    thrower.className = "mermaid-block";
    thrower.setAttribute("data-render-state", "pending");
    root.append(thrower);
    onFirstVisible(thrower, () => {
      throw new Error("NodeView mount blew up");
    });

    const ok = addSlowMermaid(50);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const unsettled = await settleHeavyBlocks(root, FAST);

    expect(ok.getAttribute("data-render-state")).toBe("done");
    expect(unsettled.map((b) => b.el)).toEqual([thrower]);
    spy.mockRestore();
  }, 30_000);
});
