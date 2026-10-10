// §28 Cmd+Click on a wikilink navigates · §56 a plain click on a date link does.
//
// The gesture is decided at MOUSEDOWN — why a click is too late is in the
// comment over the handler (wikilink.ts), measured in Chrome.
//
// jsdom has no default action to run, so the reveal itself cannot happen here.
// What these tests pin is the press: whether the editor takes it (navigates and
// prevents the default) or leaves it to the browser.
//
// React NodeViews only mount through an <EditorContent> Portals host and land a
// tick after the transaction — see wikilink-view.test.tsx for `flush()`.
import { act, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../index";

describe("§28 wikilink navigation is decided at mousedown", () => {
  let editor: Editor;

  afterEach(() => {
    editor.destroy();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  async function setup(attrs: Record<string, string>) {
    const onNavigate = vi.fn();
    editor = new Editor({
      content: "<p>seed</p>",
      extensions: createBaramExtensions({ onNavigate }),
    });
    render(<EditorContent editor={editor} />);
    act(() => {
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { attrs, type: "wikilink" },
              { text: " — trailing words", type: "text" },
            ],
          },
        ],
      });
    });
    await flush();
    const link = editor.view.dom.querySelector(".wikilink") as HTMLElement;
    return { link, onNavigate };
  }

  /** Dispatches a press; returns whether something prevented its default. */
  function press(el: Element, init: MouseEventInit = {}): boolean {
    return !el.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        ...init,
      }),
    );
  }

  it("navigates on a Cmd press and keeps the browser from moving the caret", async () => {
    const { link, onNavigate } = await setup({
      heading: "Heading",
      target: "note",
      vaultAlias: "Zettel",
    });

    expect(press(link, { metaKey: true })).toBe(true);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(
      "note",
      "Heading",
      "Zettel",
    );
  });

  it("navigates on a Ctrl press as well", async () => {
    const { link, onNavigate } = await setup({ target: "note" });

    expect(press(link, { ctrlKey: true })).toBe(true);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("note", null, null);
  });

  it("does not navigate a second time on the click that ends the press", async () => {
    const { link, onNavigate } = await setup({ target: "note" });

    press(link, { metaKey: true });
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        metaKey: true,
      }),
    );

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("navigates on a plain press when the target is a date (§56)", async () => {
    const { link, onNavigate } = await setup({ target: "2026-10-09" });

    expect(press(link)).toBe(true);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(
      "2026-10-09",
      null,
      null,
    );
  });

  it("leaves a plain press on an ordinary link to the editor", async () => {
    const { link, onNavigate } = await setup({ target: "note" });

    expect(press(link)).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("leaves a Cmd press with another button alone", async () => {
    const { link, onNavigate } = await setup({ target: "note" });

    expect(press(link, { button: 2, metaKey: true })).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("does not navigate on a Cmd press on the paragraph the link starts", async () => {
    const { link, onNavigate } = await setup({ target: "note" });

    // The paragraph's first position is the link's — a press resolved by
    // position alone, not by what was pressed, would take this one.
    expect(press(link.closest("p") as HTMLElement, { metaKey: true })).toBe(
      false,
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
