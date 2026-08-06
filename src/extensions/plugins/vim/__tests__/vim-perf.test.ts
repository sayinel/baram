// §298 vim — performance boundaries (dedicated performance review).
//
// These pin COST, not behavior, and they do it by counting work rather than
// timing it: allocation and re-render taxes are what a key-repeat session
// actually feels, and counters do not flake under parallel-suite load.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../../stores/ui/ui";
import { createBaramExtensions } from "../../../index";
import { graphemeIndexSize } from "../adapters/graphemes";
import { resolveMotion } from "../adapters/motions";
import { scrollCursorIntoView } from "../adapters/scroll";
import { vimPluginKey } from "../vim-keys";
import { setWysiwygVimStatusOwner } from "../vim-status";

vi.mock("../adapters/scroll", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, scrollCursorIntoView: vi.fn() };
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
