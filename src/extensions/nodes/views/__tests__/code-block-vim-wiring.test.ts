// §298 Phase 0b S2 — vim controller wiring in the code block island:
// loading barrier, broadcast memo replay, teardown on CM replacement,
// and no focus steal from a lazy load.
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
    press("Escape"); // normal-mode Esc falls through → block exit
    await vi.waitFor(() => {
      const sel = editor.state.selection;
      let pos = -1;
      editor.state.doc.descendants((n, p) => {
        if (pos < 0 && n.type.name === "codeBlock") pos = p;
        return pos < 0;
      });
      expect(sel.from).toBeLessThanOrEqual(pos); // PM selection left the block
    });
    editor.destroy();
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
