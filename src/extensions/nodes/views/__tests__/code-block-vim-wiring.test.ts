// §298 Phase 0b S2 — vim controller wiring in the code block island:
// loading barrier, broadcast memo replay, teardown on CM replacement,
// and no focus steal from a lazy load.
import { EditorView as CMEditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";
import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { useSettingsStore } from "../../../../stores/settings/store";
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

/** Read the island's live vim state through the CM view under `content`. */
function islandVimState(
  content: HTMLElement,
): undefined | { insertMode?: boolean; insertModeReturn?: boolean } {
  const cmv = CMEditorView.findFromDOM(content);
  const cm = cmv ? getCM(cmv) : null;
  return (
    cm?.state as
      undefined | { vim?: { insertMode?: boolean; insertModeReturn?: boolean } }
  )?.vim;
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

  it("a language change reconfigures IN PLACE — same CM, focus intact", async () => {
    // Recreation reset vim to normal mid-typing (a language undo while in
    // insert) and blurred the island (R6). In place, nothing is lost.
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    document.body.appendChild(editor.view.dom);
    setVim(editor, true);
    const content = await revealCM(editor);
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
    await new Promise((r) => setTimeout(r, 80)); // async lang extension
    const dom = editor.view.dom as HTMLElement;
    const after = dom.querySelector(".cm-content") as HTMLElement;
    expect(after).toBe(content); // SAME view — never torn down
    expect(document.activeElement).toBe(content); // focus never moved
    expect(content.getAttribute("contenteditable")).toBe("false"); // vim armed
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("a settings recreate re-enters INSERT and restores focus", async () => {
    // The one remaining recreation path. A theme/settings flip while the
    // user types inside a block must not turn their keystrokes into
    // normal-mode commands (R6).
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    document.body.appendChild(editor.view.dom);
    setVim(editor, true);
    const content = await revealCM(editor);
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const press = (key: string) =>
      dom.querySelector(".cm-content")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key,
        }),
      );
    const dom = editor.view.dom as HTMLElement;
    await vi.waitFor(() => {
      press("i");
      expect(content.getAttribute("contenteditable")).toBe("true"); // insert
    });
    const flipped = !useSettingsStore.getState().codeBlockLineNumbers;
    useSettingsStore.setState({ codeBlockLineNumbers: flipped });
    await vi.waitFor(() => {
      const fresh = dom.querySelector(".cm-content") as HTMLElement;
      expect(fresh).not.toBeNull();
      expect(fresh).not.toBe(content); // recreated
      expect(document.activeElement).toBe(fresh); // focus restored
      expect(fresh.getAttribute("contenteditable")).toBe("true"); // INSERT
    });
    useSettingsStore.setState({ codeBlockLineNumbers: !flipped });
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("language and content changing in ONE update keep the CM in sync", async () => {
    // The language branch used to return before the content sync — a tr
    // carrying both forked the CM buffer from the document (R7).
    const editor = createEditor("```ts\nab\n```\n");
    setVim(editor, true);
    const content = await revealCM(editor);
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === "codeBlock") pos = p;
      return pos < 0;
    });
    const tr = editor.state.tr
      .setNodeMarkup(pos, undefined, { language: "python" })
      .insertText("X", pos + 1);
    editor.view.dispatch(tr);
    await vi.waitFor(() => {
      const cmv = CMEditorView.findFromDOM(content)!;
      expect(cmv.state.doc.toString()).toBe("Xab");
    });
    editor.destroy();
  });

  it("BACK-TO-BACK settings recreates still restore INSERT", async () => {
    // The restore memo was consumed on read — a second recreate arriving
    // before the deferred handleKey saw normal and erased it (R7).
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    document.body.appendChild(editor.view.dom);
    setVim(editor, true);
    const content = await revealCM(editor);
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const dom = editor.view.dom as HTMLElement;
    const press = (key: string) =>
      dom.querySelector(".cm-content")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key,
        }),
      );
    await vi.waitFor(() => {
      press("i");
      expect(
        dom.querySelector(".cm-content")!.getAttribute("contenteditable"),
      ).toBe("true");
    });
    const base = useSettingsStore.getState().codeBlockLineNumbers;
    useSettingsStore.setState({ codeBlockLineNumbers: !base });
    useSettingsStore.setState({ codeBlockLineNumbers: base }); // immediate 2nd
    await vi.waitFor(() => {
      const fresh = dom.querySelector(".cm-content") as HTMLElement;
      expect(fresh).not.toBeNull();
      expect(document.activeElement).toBe(fresh);
      expect(fresh.getAttribute("contenteditable")).toBe("true"); // INSERT
    });
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("explicit vim OFF discards the restore memo — re-enable is NORMAL", async () => {
    // A settings recreate in INSERT stores a restore memo; turning vim
    // OFF before the memo is confirmed must discard it — a later ON must
    // start in normal, not resurrect insert (R8).
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    document.body.appendChild(editor.view.dom);
    setVim(editor, true);
    const content = await revealCM(editor);
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const dom = editor.view.dom as HTMLElement;
    const press = (key: string) =>
      dom.querySelector(".cm-content")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key,
        }),
      );
    await vi.waitFor(() => {
      press("i");
      expect(
        dom.querySelector(".cm-content")!.getAttribute("contenteditable"),
      ).toBe("true");
    });
    const base = useSettingsStore.getState().codeBlockLineNumbers;
    useSettingsStore.setState({ codeBlockLineNumbers: !base }); // recreate
    setVim(editor, false); // OFF while the memo is unconfirmed
    setVim(editor, true); // later ON
    await vi.waitFor(() => {
      const fresh = dom.querySelector(".cm-content") as HTMLElement;
      expect(fresh).not.toBeNull();
      // vim armed again — and in NORMAL (host barrier), never insert
      expect(fresh.getAttribute("contenteditable")).toBe("false");
    });
    await new Promise((r) => setTimeout(r, 80)); // any stray restore
    expect(
      (dom.querySelector(".cm-content") as HTMLElement).getAttribute(
        "contenteditable",
      ),
    ).toBe("false");
    useSettingsStore.setState({ codeBlockLineNumbers: base });
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("empty-block Backspace conversion moves FOCUS to PM too", async () => {
    const editor = createEditor("```ts\n\n```\n");
    document.body.appendChild(editor.view.dom);
    setVim(editor, true);
    const content = await revealCM(editor);
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const dom = editor.view.dom as HTMLElement;
    const press = (key: string) =>
      dom.querySelector(".cm-content")?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key,
        }),
      );
    await vi.waitFor(() => {
      press("i");
      expect(
        dom.querySelector(".cm-content")!.getAttribute("contenteditable"),
      ).toBe("true");
    });
    press("Backspace");
    await vi.waitFor(() => {
      let hasCodeBlock = false;
      editor.state.doc.descendants((n) => {
        if (n.type.name === "codeBlock") hasCodeBlock = true;
        return !hasCodeBlock;
      });
      expect(hasCodeBlock).toBe(false);
      // focus followed the conversion — view.focus() alone is
      // editable-gated on the vim-modal surface (R7)
      expect(document.activeElement).toBe(editor.view.dom);
    });
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("a selection SPANNING past the block never re-claims focus", async () => {
    // stillHere checked only selection.from — a selection reaching from
    // inside the block into the next paragraph passed it (R6).
    const editor = createEditor("```ts\nab\n```\n\npara\n");
    document.body.appendChild(editor.view.dom);
    setVim(editor, true);
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === "codeBlock") pos = p;
      return pos < 0;
    });
    editor.commands.setTextSelection(pos + 1); // memo lands (cold block)
    editor.commands.setTextSelection({
      from: pos + 1,
      to: editor.state.doc.content.size - 2, // …into the paragraph
    });
    const content = await revealCM(editor);
    await new Promise((r) => setTimeout(r, 80));
    expect(document.activeElement).not.toBe(content);
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("a MOUSE CLICK enters the island while vim is in normal mode", async () => {
    // Device finding (PR 307 review): with vim on, clicking a code block did
    // nothing — only pressing `i` first got the user in. In normal mode the
    // PM view is non-editable AND the island is broadcast read-only, so the
    // island only becomes editable once it is focused (suspension), and the
    // focus it needs is the very thing the click was supposed to deliver.
    // Nothing in the chain gives it, so the click has to hand focus over
    // explicitly.
    const editor = new Editor({
      content: "",
      element: document.body.appendChild(document.createElement("div")),
      extensions: createBaramExtensions(),
    });
    const doc = markdownToProsemirror(
      "```ts\nconst x = 1;\n```\n",
      editor.schema,
    );
    editor.commands.setContent(doc.toJSON());
    setVim(editor, true);
    const content = await revealCM(editor);
    document.body.focus();
    expect(document.activeElement).not.toBe(content);

    // Emulate the platform that does NOT hand focus over on its own: WebKit
    // does not focus a `contenteditable=false` element with a negative
    // tabindex on click, which is exactly the island's shape under the vim
    // barrier. Suppressing the default action is how that looks from here.
    const swallow = (e: Event) => e.preventDefault();
    document.addEventListener("mousedown", swallow, true);
    content.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    document.removeEventListener("mousedown", swallow, true);
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(content);
    });
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("insert-mode ARROW exit normalizes the island back to NORMAL (issue 475)", async () => {
    // The non-vim keymap's edge ArrowDown escape is mode-blind (insert-mode
    // arrows pass through vim), so it can fire from INSERT — and outside the
    // block PM vim is normal by construction. Leaving must therefore end the
    // insert session; the stale island otherwise revives insert on re-entry.
    const editor = createEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealCM(editor);
    document.body.appendChild(editor.view.dom);
    content.setAttribute("tabindex", "0");
    await vi.waitFor(() => {
      expect(content.getAttribute("contenteditable")).toBe("false");
    });
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const press = (key: string, init: KeyboardEventInit = {}) =>
      content.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key,
          ...init,
        }),
      );
    await vi.waitFor(() => {
      press("i");
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    press("ArrowDown"); // single source line = last line: escape fires
    await vi.waitFor(() => {
      expect(islandVimState(content)?.insertMode ?? false).toBe(false);
      expect(content.getAttribute("contenteditable")).toBe("false");
      expect(document.activeElement).not.toBe(content);
    });
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("C-o pending state: edge k stays in the block and RETURNS to insert (issue 475)", async () => {
    // <C-o> parks vim in normal mode with insertModeReturn set — NOT idle
    // normal. The boundary must decline the edge key so vim can run the one
    // normal command and re-enter insert (stock vim), instead of hijacking
    // it into a block exit that strands the latent insert return.
    const editor = createEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealCM(editor);
    document.body.appendChild(editor.view.dom);
    content.setAttribute("tabindex", "0");
    await vi.waitFor(() => {
      expect(content.getAttribute("contenteditable")).toBe("false");
    });
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const press = (key: string, init: KeyboardEventInit = {}) =>
      content.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key,
          ...init,
        }),
      );
    await vi.waitFor(() => {
      press("i");
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    press("o", { ctrlKey: true });
    await vi.waitFor(() => {
      expect(islandVimState(content)?.insertModeReturn).toBe(true);
    });
    press("k"); // line 1: an idle-normal boundary would consume and escape
    await vi.waitFor(() => {
      expect(content.getAttribute("contenteditable")).toBe("true");
      expect(document.activeElement).toBe(content);
    });
    editor.destroy();
    document.body.innerHTML = "";
  });
});
