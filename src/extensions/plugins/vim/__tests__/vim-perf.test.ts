// §298 vim — performance boundaries (dedicated performance review).
//
// These pin COST, not behavior, and they do it by counting work rather than
// timing it: allocation and re-render taxes are what a key-repeat session
// actually feels, and counters do not flake under parallel-suite load.

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../../stores/ui/ui";
import { createBaramExtensions } from "../../../index";
import { columnAt, lineUnitStarts } from "../adapters/cursor-line-columns";
import { graphemeIndexSize } from "../adapters/graphemes";
import { resolveMotion } from "../adapters/motions";
import { terminalClampTarget } from "../adapters/normal-cursor";
import { scrollCursorIntoView } from "../adapters/scroll";
import { vimPluginKey } from "../vim-keys";
import { setWysiwygVimStatusOwner } from "../vim-status";

vi.mock("../adapters/scroll", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, scrollCursorIntoView: vi.fn() };
});

// issue 776 — count goal-column measurements; delegates to the real function.
vi.mock("../adapters/cursor-line-columns", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../adapters/cursor-line-columns")>();
  return {
    ...actual,
    columnAt: vi.fn(actual.columnAt),
    lineUnitStarts: vi.fn(actual.lineUnitStarts),
  };
});

const editors: Editor[] = [];

function enable(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      enabled: true,
      type: "setEnabled",
    }),
  );
}

function key(editor: Editor, k: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: k }),
  );
}

function makeEditor(content: string): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  setWysiwygVimStatusOwner(null);
  vi.clearAllMocks();
  for (const e of editors.splice(0)) e.destroy();
});

describe("the status feed does not tax every transaction", () => {
  it("writes the UI store ONLY when the mode actually changes", () => {
    // publish() runs on every view update. Zustand treats each partial as a
    // new root and notifies EVERY listener — the repo has identity
    // useUIStore() subscriptions that then re-render, so an unchanged value
    // must not reach the store at all. This taxes plain typing too: the
    // owner is appointed whenever the WYSIWYG surface is active, vim on or
    // off (performance review P1).
    const editor = makeEditor("<p>alpha</p>");
    setWysiwygVimStatusOwner(editor);
    let writes = 0;
    const unsubscribe = useUIStore.subscribe(() => writes++);

    // vim OFF: ten transactions must not touch the store.
    for (let i = 0; i < 10; i++) {
      editor.view.dispatch(editor.state.tr.insertText("x", 1));
    }
    expect(writes).toBe(0);

    // enabling is a real change — exactly one write.
    enable(editor);
    expect(writes).toBe(1);

    // vim ON, mode unchanged: still no further writes.
    for (let i = 0; i < 10; i++) {
      key(editor, "l");
    }
    expect(writes).toBe(1);

    // a mode change writes once.
    key(editor, "i");
    expect(writes).toBe(2);
    unsubscribe();
  });
});

describe("motions do not rebuild the document line index", () => {
  it("traverses the document ONCE per document, not once per motion", () => {
    // collectLines walks the whole doc and allocates a line object each
    // time; verticalTarget and wordWalk called it for every j/k/w/b, which
    // measured ~4.8MB of transient garbage per keystroke on a 10k-paragraph
    // document (performance review P2).
    const editor = makeEditor(
      Array.from({ length: 200 }, (_, i) => `<p>line ${i}</p>`).join(""),
    );
    const doc = editor.state.doc;
    const original = doc.descendants.bind(doc);
    let traversals = 0;
    (doc as unknown as { descendants: typeof original }).descendants = (
      ...args: Parameters<typeof original>
    ) => {
      traversals++;
      return original(...args);
    };

    let pos = 1;
    for (let i = 0; i < 20; i++) {
      pos = resolveMotion(editor.state, pos, "lineDown", 1);
    }
    resolveMotion(editor.state, pos, "wordForward", 1);
    resolveMotion(editor.state, pos, "docEnd", 1);

    expect(traversals).toBe(1); // once for this doc; the rest are cache hits
  });

  it("a new document re-indexes (the cache is keyed by doc identity)", () => {
    const editor = makeEditor("<p>one</p><p>two</p>");
    const first = resolveMotion(editor.state, 1, "docEnd", 1);
    editor.commands.setContent("<p>a</p><p>b</p><p>c</p>");
    const second = resolveMotion(editor.state, 1, "docEnd", 1);
    expect(second).not.toBe(first); // fresh index, not a stale array
  });
});

describe("cursor following runs exactly once per command", () => {
  /** Transactions a command dispatched, in order. */
  function recordDispatches(editor: Editor): { scrollFlags: boolean[] } {
    const scrollFlags: boolean[] = [];
    const original = editor.view.dispatch.bind(editor.view);
    editor.view.dispatch = (tr) => {
      scrollFlags.push(tr.scrolledIntoView);
      original(tr);
    };
    return { scrollFlags };
  }

  it("a motion asks for ONE follow — the adapter, not PM as well", () => {
    // vim owns cursor following (PM's pipeline is dead on a non-editable
    // surface). Flagging the transaction too makes PM run its own pass
    // whenever the DOM selection IS inside the view — two coordsAtPos and
    // ~18 getComputedStyle calls for one j (performance review P4).
    const editor = makeEditor("<p>one</p><p>two</p>");
    editor.commands.setTextSelection(1);
    enable(editor);
    const recorded = recordDispatches(editor);
    vi.mocked(scrollCursorIntoView).mockClear();
    key(editor, "j");
    expect(vi.mocked(scrollCursorIntoView).mock.calls).toHaveLength(1);
    expect(recorded.scrollFlags.some(Boolean)).toBe(false);
  });

  it("an edit asks for ONE follow too", () => {
    const editor = makeEditor("<p>one</p><p>two</p>");
    editor.commands.setTextSelection(1);
    enable(editor);
    const recorded = recordDispatches(editor);
    vi.mocked(scrollCursorIntoView).mockClear();
    key(editor, "d");
    key(editor, "d");
    expect(vi.mocked(scrollCursorIntoView).mock.calls).toHaveLength(1);
    expect(recorded.scrollFlags.some(Boolean)).toBe(false);
  });
});

describe("the grapheme index is released when vim stops owning the surface", () => {
  it("disabling vim releases it, not only destroying the view", () => {
    // The index retained ~10.4MB for a 1M-character line; destroy released
    // it but turning vim off did not (performance review P3).
    const editor = makeEditor("<p>abcdef</p>");
    editor.commands.setTextSelection(4);
    enable(editor);
    key(editor, "h"); // builds the index for this text node
    expect(graphemeIndexSize()).toBeGreaterThan(0);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        enabled: false,
        type: "setEnabled",
      }),
    );
    expect(graphemeIndexSize()).toBe(0);
  });
});

// issue 776 — the goal column must cost nothing per keystroke. Counted as
// calls to columnAt, the one origin-column measurement (wrapped by the mock
// above, which delegates to the real function) — not as Intl.Segmenter calls,
// which a grapheme cache or another plugin's segmentation would change without
// changing what the goal column costs.
describe("goal column cost (issue 776)", () => {
  const LINE = "abcdefghij";

  it("a supplied goal skips the origin measurement in the walk", () => {
    // Fails if: verticalTarget measures the origin column whether or not a
    // goal was handed in.
    const editor = makeEditor(`<p>${LINE}</p><p>${LINE}</p>`);
    const from = 7; // "g"
    vi.mocked(columnAt).mockClear();
    resolveMotion(editor.state, from, "lineDown", 1, { goalColumn: 6 });
    expect(vi.mocked(columnAt)).not.toHaveBeenCalled();
    resolveMotion(editor.state, from, "lineDown", 1);
    expect(vi.mocked(columnAt)).toHaveBeenCalledTimes(1);
  });

  it("a run of j measures the origin column once, not per j", () => {
    // Fails if: the selection path measures columnAt on every j instead of
    // only when the core's goal is null, or verticalTarget re-measures the
    // origin although the goal was handed in.
    const editor = makeEditor(`<p>${LINE}</p>`.repeat(6));
    enable(editor);
    editor.commands.setTextSelection(7);
    vi.mocked(columnAt).mockClear();
    key(editor, "j");
    key(editor, "j");
    key(editor, "j");
    expect(vi.mocked(columnAt)).toHaveBeenCalledTimes(1);
  });

  it("typing in insert mode measures no column", () => {
    // Fails if: the keydown path measures the cursor's column per key (the
    // eager StepContext.column design the plan rejected).
    const editor = makeEditor(`<p>${LINE}</p>`);
    enable(editor);
    editor.commands.setTextSelection(3);
    key(editor, "i");
    expect(
      (vimPluginKey.getState(editor.state) as unknown as { mode: string }).mode,
    ).toBe("insert");
    vi.mocked(columnAt).mockClear();
    vi.mocked(lineUnitStarts).mockClear();
    for (const k of ["x", "y", "z"]) key(editor, k);
    expect(vi.mocked(columnAt)).not.toHaveBeenCalled();
    // …nor builds a line's unit list some other way (columnOf over
    // lineUnitStarts is the inline form of the same measurement).
    expect(vi.mocked(lineUnitStarts)).not.toHaveBeenCalled();
  });
});

// issue 776 — the first non-blank (gg, G, :N, ^) is found in ONE traversal.
describe("first non-blank cost (issue 776)", () => {
  it("a line of many marked blank text nodes is not walked once per unit", () => {
    // Fails if: lineFirstNonBlank calls textBetween per cursor unit — each
    // call restarts the range walk at the first child, quadratic here.
    const blanks = Array.from({ length: 400 }, (_, i) => ({
      marks: [{ type: i % 2 === 0 ? "bold" : "italic" }],
      text: " ",
      type: "text",
    }));
    const editor = makeEditor("<p>x</p>");
    editor.commands.setContent({
      content: [
        {
          content: [...blanks, { text: "end", type: "text" }],
          type: "paragraph",
        },
      ],
      type: "doc",
    });
    const spy = vi.spyOn(
      Object.getPrototypeOf(editor.state.doc),
      "textBetween",
    );
    try {
      const target = resolveMotion(editor.state, 1, "lineFirstNonBlank", 1);
      expect(spy).not.toHaveBeenCalled();
      expect(editor.state.doc.resolve(target).parentOffset).toBe(400); // "end"
    } finally {
      spy.mockRestore();
    }
  });
});

// issue 776 — the normal-mode clamp's early rejection reads no text.
describe("terminal clamp cost (issue 776)", () => {
  it("a caret inside a text node is rejected without cutting the node", () => {
    // Fails if: terminalClampTarget reads $head.nodeAfter before checking
    // textOffset — for a position inside a text node ProseMirror cuts a copy
    // of the node's remaining text, on every normal-mode transaction.
    const editor = makeEditor(`<p>${"x".repeat(1000)}</p>`);
    const textNode = editor.state.doc.child(0).child(0);
    const spy = vi.spyOn(Object.getPrototypeOf(textNode), "cut");
    try {
      const state = editor.state.apply(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 500),
        ),
      );
      spy.mockClear();
      expect(terminalClampTarget(state)).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
