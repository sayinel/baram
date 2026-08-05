// §298 Phase 0b S2 — vim controller wiring in the code block island:
// loading barrier, broadcast memo replay, teardown on CM replacement,
// and no focus steal from a lazy load.
import { EditorView as CMEditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";
import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { vimPluginKey } from "../../../plugins/vim/vim-keys";

if (typeof window.matchMedia !== "function") {
  window.matchMedia = () =>
    ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
}

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

// jsdom lacks Range measurement — an ATTACHED CodeMirror schedules a rAF
// measure pass that would otherwise throw asynchronously (same polyfill as
// vim-markdown-enter.test.ts).
const zeroRect = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
  x: 0,
  y: 0,
};
Range.prototype.getBoundingClientRect ??= () => zeroRect as DOMRect;
Range.prototype.getClientRects ??= () =>
  ({
    item: () => null,
    length: 0,
    [Symbol.iterator]: [][Symbol.iterator],
  }) as unknown as DOMRectList;
HTMLElement.prototype.getClientRects ??= Range.prototype.getClientRects;

function createEditor(md: string): Editor {
  const editor = new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
  const doc = markdownToProsemirror(md, editor.schema);
  editor.commands.setContent(doc.toJSON());
  return editor;
}

async function revealCM(editor: Editor): Promise<HTMLElement> {
  const dom = editor.view.dom as HTMLElement;
  // Trigger EVERY registered observer — the code block's is not reliably
  // the newest (the virtualizer and stale editors register observers too).
  for (const io of MockIntersectionObserver.instances) {
    io.triggerIntersect(true);
  }
  await vi.waitFor(() => {
    expect(dom.querySelector(".cm-editor")).not.toBeNull();
  });
  return dom.querySelector(".cm-content") as HTMLElement;
}

function setVim(editor: Editor, enabled: boolean): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, { enabled, type: "setEnabled" }),
  );
}

describe("code block vim wiring (S2)", () => {
  it("enabling vim raises a SYNCHRONOUS editing-host barrier", async () => {
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    const content = await revealCM(editor);
    expect(content.getAttribute("contenteditable")).toBe("true");
    setVim(editor, true);
    // The barrier lands in the same tick — beforeinput fires before
    // keydown, so an async gate would leak IME text while vim loads.
    expect(content.getAttribute("contenteditable")).toBe("false");
    // And the island stays FOCUSABLE through the load: tabindex must come
    // with the barrier, not after the async module resolves — an explicit
    // PM entry into a cold block would otherwise lose focus.
    expect(content.getAttribute("tabindex")).toBe("-1");
    editor.destroy();
  });

  it("a LAZY block created after enabling vim replays the memo", async () => {
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    setVim(editor, true); // before the block is visible
    const content = await revealCM(editor);
    expect(content.getAttribute("contenteditable")).toBe("false");
    // and the lazy load never steals focus from PM
    await new Promise((r) => setTimeout(r, 120));
    expect(document.activeElement).not.toBe(content);
    editor.destroy();
  });

  it("disabling vim restores plain editing", async () => {
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    const content = await revealCM(editor);
    setVim(editor, true);
    expect(content.getAttribute("contenteditable")).toBe("false");
    setVim(editor, false);
    await vi.waitFor(() => {
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    editor.destroy();
  });

  it("Esc stair: insert to normal to BLOCK EXIT into PM", async () => {
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    setVim(editor, true);
    const content = await revealCM(editor);
    // Attached + focusable so document.activeElement is real: the escape
    // must move FOCUS out too — PM's view.focus() skips dom.focus on a
    // non-editable (vim modal) view (installed prosemirror-view :5711).
    document.body.appendChild(editor.view.dom);
    content.setAttribute("tabindex", "0");
    // vim ready = the editing-host barrier holds in normal mode
    await vi.waitFor(() => {
      expect(content.getAttribute("contenteditable")).toBe("false");
    });
    content.focus();
    // jsdom's focus() does not synthesize focusin — dispatch it so the PM
    // suspension chain releases the island's readOnly (the device flow).
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    const press = (key: string) =>
      content.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
      );

    // The barrier's contenteditable=false is NOT a ready signal — retry
    // `i` until vim is attached and answers with insert mode (the extra
    // presses land on a host-less island and are dropped by design).
    await vi.waitFor(() => {
      press("i"); // retried until vim is attached and answers with insert
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    press("Escape"); // back to normal — host removed again
    await vi.waitFor(() => {
      expect(content.getAttribute("contenteditable")).toBe("false");
    });
    content.focus();
    press("Escape"); // normal-mode Esc falls through → block exit
    await vi.waitFor(() => {
      const sel = editor.state.selection;
      let pos = -1;
      editor.state.doc.descendants((n, p) => {
        if (pos < 0 && n.type.name === "codeBlock") pos = p;
        return pos < 0;
      });
      expect(sel.from).toBeLessThanOrEqual(pos); // PM selection left the block
      // and FOCUS left the island (device finding: selection moved while
      // focus stayed on cm-content, so keys kept feeding the block)
      expect(document.activeElement).not.toBe(content);
    });
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("edge j in normal mode exits DOWN into PM", async () => {
    const editor = createEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealCM(editor);
    await vi.waitFor(() => {
      expect(content.getAttribute("contenteditable")).toBe("false");
    });
    content.focus();
    content.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "j",
      }),
    );
    await vi.waitFor(() => {
      let pos = -1;
      let size = 0;
      editor.state.doc.descendants((n, p) => {
        if (pos < 0 && n.type.name === "codeBlock") {
          pos = p;
          size = n.nodeSize;
        }
        return pos < 0;
      });
      expect(editor.state.selection.from).toBeGreaterThanOrEqual(pos + size);
    });
    editor.destroy();
  });

  it("Backspace in an EMPTY block still converts to a paragraph (insert)", async () => {
    const editor = createEditor("```ts\n\n```\n");
    setVim(editor, true);
    const content = await revealCM(editor);
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const press = (key: string) =>
      content.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
      );
    await vi.waitFor(() => {
      press("i"); // vim ready + insert mode restores the host
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    press("Backspace"); // insert-mode Backspace reaches customKeys
    await vi.waitFor(() => {
      let hasCodeBlock = false;
      editor.state.doc.descendants((n) => {
        if (n.type.name === "codeBlock") hasCodeBlock = true;
        return !hasCodeBlock;
      });
      expect(hasCodeBlock).toBe(false); // converted to a paragraph
    });
    editor.destroy();
  });

  it("enabling vim while focus is INSIDE the island re-suspends PM", async () => {
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    const content = await revealCM(editor);
    // jsdom only focuses elements ATTACHED to the document, and does not
    // treat contenteditable as focusable — attach and add a tabindex so
    // document.activeElement really lands inside the island marker.
    document.body.appendChild(editor.view.dom);
    content.setAttribute("tabindex", "0");
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    // vim OFF at focus time — no suspension was recorded. Enabling now
    // fires no new focusin; the transition must re-evaluate on its own.
    setVim(editor, true);
    await vi.waitFor(() => {
      const vim = vimPluginKey.getState(editor.state) as {
        suspended?: boolean;
      };
      expect(vim?.suspended).toBe(true);
    });
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("the loading window is READ-ONLY — no plain CM edit before vim", async () => {
    // The editable facet does not gate key-BOUND edits (installed cm-view
    // :8818, Enter/Backspace mutate whenever readOnly is false), and the
    // suspension broadcast releases the island's readOnly on focus — so
    // the barrier itself must pin readOnly through the load (R5 C7).
    const editor = createEditor("```ts\nab\n```\n");
    const content = await revealCM(editor);
    const cmv = CMEditorView.findFromDOM(content)!;
    setVim(editor, true);
    // The hole opens on FOCUS: suspension releases the broadcast readOnly
    // while the vim chunk is still loading.
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await Promise.resolve(); // suspension microtask
    expect(cmv.state.readOnly).toBe(true); // the barrier must still hold
    content.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );
    expect(editor.state.doc.textContent).toBe("ab"); // nothing landed
    // vim ready → the barrier hands over (readOnly lifts, vim owns keys)
    const press = (key: string) =>
      content.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
      );
    await vi.waitFor(() => {
      press("i");
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    expect(cmv.state.readOnly).toBe(false);
    editor.destroy();
  });

  it("a STALE pending selection never steals focus back (cold entry)", async () => {
    const editor = createEditor("```ts\nab\n```\n\npara\n");
    document.body.appendChild(editor.view.dom);
    setVim(editor, true);
    // Selection enters the COLD block (no CM yet) → pendingSelection memo,
    // then the user moves on before the CM ever materializes.
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === "codeBlock") pos = p;
      return pos < 0;
    });
    editor.commands.setTextSelection(pos + 1);
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    const content = await revealCM(editor);
    await new Promise((r) => setTimeout(r, 80));
    expect(document.activeElement).not.toBe(content); // no focus theft
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("a language change RESTORES focus into the recreated island", async () => {
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    document.body.appendChild(editor.view.dom);
    setVim(editor, true);
    const content = await revealCM(editor);
    content.setAttribute("tabindex", "0");
    content.focus();
    expect(document.activeElement).toBe(content);
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === "codeBlock") pos = p;
      return pos < 0;
    });
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { language: "python" }),
    );
    const dom = editor.view.dom as HTMLElement;
    await vi.waitFor(() => {
      const fresh = dom.querySelector(".cm-content") as HTMLElement;
      expect(fresh).not.toBeNull();
      expect(fresh).not.toBe(content); // recreated
      // focus followed into the replacement (R5 C10: CM destroy blurs the
      // old contentDOM and nothing restored it — keys fell into the void)
      expect(document.activeElement).toBe(fresh);
    });
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("a language change tears down and re-arms vim on the new CM", async () => {
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    await revealCM(editor);
    setVim(editor, true);
    // Change the language attr → NodeView replaces its CM instance.
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === "codeBlock") pos = p;
      return pos < 0;
    });
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { language: "python" }),
    );
    const dom = editor.view.dom as HTMLElement;
    await vi.waitFor(() => {
      const content = dom.querySelector(".cm-content") as HTMLElement;
      expect(content).not.toBeNull();
      // The recreated CM consumed the memo — barrier present again.
      expect(content.getAttribute("contenteditable")).toBe("false");
    });
    editor.destroy();
  });
});
