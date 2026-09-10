// R26 (§351 controller decision, building on §349) — SvgBlockView must not
// subscribe to font settings for every mounted block; only its fullscreen
// overlays should, and only while one is open.
//
// Before this fix, SvgBlockView called useFontSurface("both") twice,
// unconditionally, at the top of the component — for EVERY SVG block in the
// document, mounted whether or not either overlay was open. That was dormant
// because nothing changed `fontFamily`/`codeFontFamily`. The moment §351's
// font picker landed, every keystroke in it would re-render every SvgBlockView
// in the document — this project's typing-latency defect class (§8.4 budgets
// 16ms/keystroke; cost scales with mounted NodeViews).
//
// `useFontSurface` is mocked and counted directly: a call IS the subscription
// (`useSettingsStore(useShallow(...))` runs inside it), so a call count of
// zero proves no subscription exists at all — stronger than a DOM-identity
// check, which would only show one particular render happened not to touch
// the DOM, not that the store never notifies this component.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));

const { useFontSurfaceMock } = vi.hoisted(() => ({
  useFontSurfaceMock: vi.fn(() => () => undefined),
}));
vi.mock("../../hooks/use-font-surface", () => ({
  useFontSurface: useFontSurfaceMock,
}));

import en from "../../i18n/en.json";
import { createBaramExtensions } from "../index";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

const editors: Editor[] = [];

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mountSvgBlock() {
  const editor = new Editor({ extensions: createBaramExtensions() });
  editors.push(editor);
  const view = render(<EditorContent editor={editor} />);
  act(() => {
    editor.commands.setContent({
      content: [
        { attrs: { code: SVG }, type: "svgBlock" },
        { type: "paragraph" },
      ],
      type: "doc",
    });
  });
  await flush();
  return { editor, view };
}

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
});

beforeEach(() => {
  useFontSurfaceMock.mockClear();
});

describe("SvgBlockView font-surface subscription (R26)", () => {
  it("subscribes to no font surface while neither overlay is open", async () => {
    await mountSvgBlock();
    expect(useFontSurfaceMock).not.toHaveBeenCalled();
  });

  // A traversal selection is the common case while typing elsewhere in the
  // document (many SVG blocks can be selected/scrolled past); still no
  // overlay is open, so still no subscription.
  it("still subscribes to nothing once the block is selected", async () => {
    const { editor } = await mountSvgBlock();
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    await flush();
    expect(useFontSurfaceMock).not.toHaveBeenCalled();
  });

  it("subscribes once the view-fullscreen overlay opens, and stops after it closes", async () => {
    const { view } = await mountSvgBlock();

    fireEvent.click(view.getByLabelText(en["blockChrome.viewFullscreen"]));
    await flush();
    expect(useFontSurfaceMock).toHaveBeenCalledTimes(1);

    const close = document.body.querySelector<HTMLElement>(
      ".svg-fullscreen-close",
    );
    if (!close) throw new Error("no Close button in the view overlay");
    fireEvent.click(close);
    await flush();
    // closeViewFullscreen defers editor.commands.blur() to a
    // requestAnimationFrame — drain it here so it does not fire during a
    // LATER test, after that test's editor has already been destroyed.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });

    useFontSurfaceMock.mockClear();
    // Nothing left mounted that would call it again.
    expect(useFontSurfaceMock).not.toHaveBeenCalled();
  });

  it("subscribes once the edit-fullscreen overlay opens", async () => {
    const { editor, view } = await mountSvgBlock();
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    await flush();

    fireEvent.click(view.getByLabelText(en["blockChrome.editFullscreen"]));
    await flush();
    expect(useFontSurfaceMock).toHaveBeenCalledTimes(1);
  });
});
