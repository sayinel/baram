// §298 D1 (PR 307 device finding) — a vim motion's selection must SURVIVE.
//
// WHAT BROKE: `k` onto a math block appeared to do nothing. Instrumented on
// device, the selection moved and then came back, and the stack named the
// culprit:
//
//   [VD-SEL] -> NodeSelection@8756  keydown << runSelectionCommand   ← vim moved it
//   [VD-SEL] -> TextSelection@8758  readDOMChange << flush           ← reverted
//
// DOMObserver.flush (installed prosemirror-view :4788) computes
//
//   newSel = !suppressingSelectionUpdates && !currentSelection.eq(sel) && …
//
// and calls handleDOMChange when it is true — mutations are irrelevant, which
// is why `ignoreMutation` on the atom cannot help (an atom NodeView has no
// contentDOM, so Tiptap already returns true there, and `ignoreSelectionChange`
// consults the desc where the DOM selection SITS: the paragraph vim just left).
//
// Under vim the view is non-editable, so PM never writes the new selection to
// the DOM. The DOM selection therefore disagrees with PM's record, flush reads
// that disagreement as "the browser moved the caret", and restores the stale
// position. suppressSelectionUpdates() answers every selectionchange in the
// next 50 ms by re-asserting state into the DOM — an active defence that
// outlasts WebKit's async churn (brokenSelectBetweenUneditable: a selection
// between non-editable blocks cannot be held, and the workaround's cleanup
// fires a LATE collapsed selectionchange). Re-baselining once with
// setCurSelection() instead was tried and REFUTED on device: `j` skipped the
// block again, because a baseline taken at dispatch time loses to an event
// that arrives after it. These pins also guard against swapping the call back.
//
// jsdom cannot reproduce the revert itself (no WebKit DOM-selection sync — a
// behavioural test reports HELD and proves nothing). So this pins the call:
// after a motion, vim suppresses the observer's next reads.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../../../stores/settings/store";
import { createBaramExtensions } from "../../../index";
import { vimPluginKey } from "../vim-keys";

const editors: Editor[] = [];

interface ObserverProbe {
  suppressSelectionUpdates: ReturnType<typeof vi.fn>;
}

function caretInBelow(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isTextblock && node.textContent === "below") {
      pos = at + 1;
    }
  });
  expect(pos).toBeGreaterThan(0);
  return pos;
}

function key(editor: Editor, k: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: k }),
  );
}

function makeEditor(): Editor {
  useSettingsStore.setState({ vimMode: true });
  const editor = new Editor({
    content: "<p></p>",
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  editor.commands.setContent({
    content: [
      { content: [{ text: "above", type: "text" }], type: "paragraph" },
      { attrs: { formula: "E=mc^2" }, type: "mathBlock" },
      { content: [{ text: "below", type: "text" }], type: "paragraph" },
    ],
    type: "doc",
  });
  return editor;
}

/** Replace the observer's suppress call with a spy. */
function probeObserver(editor: Editor): ObserverProbe {
  const spy = vi.fn();
  const observer = (
    editor.view as unknown as {
      domObserver?: { suppressSelectionUpdates?: () => void };
    }
  ).domObserver;
  expect(observer).toBeDefined(); // the API this fix relies on must exist
  if (observer) observer.suppressSelectionUpdates = spy;
  return { suppressSelectionUpdates: spy };
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
  useSettingsStore.setState({ vimMode: false });
});

describe("a motion suppresses the DOM observer's re-read", () => {
  it("`k` onto a math block suppresses the observer's re-read", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(caretInBelow(editor));
    const probe = probeObserver(editor);

    key(editor, "k");

    expect(probe.suppressSelectionUpdates).toHaveBeenCalled();
  });

  it("an ordinary paragraph motion suppresses it too", () => {
    // Not atom-specific: any non-editable move leaves the DOM selection
    // behind, so the same disagreement exists between two paragraphs.
    const editor = makeEditor();
    editor.commands.setTextSelection(1);
    const probe = probeObserver(editor);

    key(editor, "j");

    expect(probe.suppressSelectionUpdates).toHaveBeenCalled();
  });

  it("the selection vim asked for is the one that stands", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(caretInBelow(editor));

    key(editor, "k");

    let mathPos = -1;
    editor.state.doc.forEach((node, at) => {
      if (node.type.name === "mathBlock") mathPos = at;
    });
    expect(editor.state.selection.from).toBe(mathPos);
  });
});

describe("vim OFF leaves the observer alone (positive control)", () => {
  it("does not suppress when vim is not driving the selection", () => {
    // A fix that suppressed unconditionally would pass the pins above while
    // muting ordinary editing, where the observer's reads are the source of
    // truth for native selection changes.
    useSettingsStore.setState({ vimMode: false });
    const editor = new Editor({
      content: "<p>alpha beta</p>",
      element: document.body.appendChild(document.createElement("div")),
      extensions: createBaramExtensions(),
    });
    editors.push(editor);
    editor.commands.setTextSelection(2);
    const probe = probeObserver(editor);

    key(editor, "j"); // plain typing surface — vim must not be involved
    expect(vimPluginKey.getState(editor.state)?.enabled).toBe(false);
    expect(probe.suppressSelectionUpdates).not.toHaveBeenCalled();
  });
});
