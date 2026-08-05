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
