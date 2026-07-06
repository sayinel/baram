// §95 WikilinkView — bare [[id]] zettel links render the live index title,
// gated so every other wikilink form (display, heading, alias::, dates) is
// unaffected.
//
// React NodeViews only mount through an <EditorContent> Portals host (a bare
// `new Editor` never renders the React portals — see math-lazy.test.tsx), so
// we render via @testing-library/react and read the editor's own DOM.
import { act, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useZettelIndexStore } from "../../../stores/zettelkasten/zettel-index";
import { createBaramExtensions } from "../../index";

describe("WikilinkView: zettel index title", () => {
  let editor: Editor;

  beforeEach(() => {
    useZettelIndexStore.getState().clear();
  });

  afterEach(() => {
    editor.destroy();
    useZettelIndexStore.getState().clear();
  });

  function setup(target: string): void {
    editor = new Editor({
      content: "<p>seed</p>",
      extensions: createBaramExtensions(),
    });
    render(<EditorContent editor={editor} />);
    act(() => {
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ attrs: { target }, type: "wikilink" }],
          },
        ],
      });
    });
  }

  it("shows the index title for a bare zettel-id link when the index has it", () => {
    useZettelIndexStore.getState().upsert({
      id: "202607051530",
      path: "notes/202607051530 원자적 노트.md",
      title: "원자적 노트",
    });
    setup("202607051530");

    const el = editor.view.dom.querySelector(".wikilink") as HTMLElement;
    expect(el.textContent).toBe("원자적 노트");
  });

  it("still shows the plain target text for a non-zettel-id link", () => {
    setup("Architecture");

    const el = editor.view.dom.querySelector(".wikilink") as HTMLElement;
    expect(el.textContent).toBe("Architecture");
  });

  it("falls back to the raw id when the index has no entry for it", () => {
    setup("202607051530");

    const el = editor.view.dom.querySelector(".wikilink") as HTMLElement;
    expect(el.textContent).toBe("202607051530");
  });
});
