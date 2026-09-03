// issue 521 (final review) — what the mermaid block menu may offer and do
// once it is reachable MID-EDIT.
//
// Attaching the block menu in editing state (the ownership fix) made three
// pre-existing edges reachable. The rendered svg is debounced and survives a
// failed render, so Copy as SVG could hand out a diagram that no longer
// matches the source on screen. Copy as PNG re-renders the live source and
// swallowed its failure, so on broken source it was a silent no-op. View
// Fullscreen's close blurred the editor, which mid-edit could take the
// session's focus away. And a right-click on the menu itself, a portal, fell
// through the block's containment guard to the browser.
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({
      svg: `<svg id="${id}" viewBox="0 0 200 100" width="200" height="100"><g><text>Start</text></g></svg>`,
    })),
  },
}));

// The raster helper: in jsdom the real one waits forever on an <img> load
// that never comes, so it is stubbed to REPORT failure — the wiring under
// test is "false from the helper → a toast", not the rasterizer itself.
vi.mock("../../utils/markdown/mermaid-utils", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../utils/markdown/mermaid-utils")
  >()),
  copyMermaidPng: vi.fn(async () => false),
}));

import { useUIStore } from "../../stores/ui/ui";
import { createBaramExtensions } from "../index";

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

const ORIGINAL = "flowchart LR\n  A --> B";
const EDITED = "flowchart LR\n  A --> B --> C";

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
});

beforeEach(() => {
  useUIStore.getState().dismissToast();
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function menu(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(".mermaid-context-menu");
}

function menuItem(label: string): HTMLElement | undefined {
  return [
    ...document.body.querySelectorAll<HTMLElement>(
      ".mermaid-context-menu-item",
    ),
  ].find((b) => b.textContent === label);
}

/** A rendered mermaid block in its edit session, with the live preview. */
async function mountEditing() {
  const editor = new Editor({ extensions: createBaramExtensions() });
  editors.push(editor);
  const view = render(<EditorContent editor={editor} />);
  act(() => {
    editor.commands.setContent({
      content: [
        { attrs: { code: ORIGINAL }, type: "mermaidBlock" },
        { type: "paragraph" },
      ],
      type: "doc",
    });
  });
  await flush();
  act(() => {
    for (const io of MockIntersectionObserver.instances) io.triggerIntersect();
  });
  await waitFor(() => {
    expect(
      view.container.querySelector(
        '[data-type="mermaidBlock"][data-render-state="done"]',
      ),
    ).not.toBeNull();
  });
  act(() => {
    editor.commands.setNodeSelection(0);
  });
  await flush();
  const preview = view.container.querySelector<HTMLElement>(
    ".mermaid-block-editing .mermaid-block-svg",
  );
  const textarea = view.container.querySelector<HTMLTextAreaElement>(
    ".mermaid-block-editing textarea",
  );
  if (!preview || !textarea) throw new Error("editing state did not mount");
  return { editor, view, preview, textarea };
}

describe("mermaid block menu, mid-edit (issue 521)", () => {
  it("withholds Copy as SVG while the rendered svg is not from the source on screen", async () => {
    const { preview, textarea } = await mountEditing();
    // The edit is live at once; the render behind it is debounced 300ms.
    fireEvent.change(textarea, { target: { value: EDITED } });
    await flush();

    fireEvent.contextMenu(preview, { clientX: 20, clientY: 80 });
    await flush();

    expect(menu()).not.toBeNull();
    expect(menuItem("Copy Source")).toBeDefined();
    expect(menuItem("Copy as SVG")).toBeUndefined();
    // Once the render catches up with the source, the item returns — the
    // open menu re-renders with the fresh svg.
    await waitFor(() => {
      expect(menuItem("Copy as SVG")).toBeDefined();
    });
  });

  it("says so when Copy as PNG fails", async () => {
    // A source that does not render never gets this far (the PNG items are
    // gated on a fresh render); what can still fail is the rasterizer or the
    // clipboard, and that failure must not be silent.
    const { preview } = await mountEditing();
    fireEvent.contextMenu(preview, { clientX: 20, clientY: 80 });
    await flush();
    const item = menuItem("Copy as PNG");
    if (!item) throw new Error("Copy as PNG item did not render");

    fireEvent.click(item);

    await waitFor(() => {
      expect(useUIStore.getState().toast?.message).toMatch(/PNG/);
    });
  });

  it("View Fullscreen from the menu, then Close, keeps the edit session and its focus", async () => {
    const { view, preview, textarea } = await mountEditing();
    textarea.focus();
    expect(document.activeElement).toBe(textarea);
    fireEvent.contextMenu(preview, { clientX: 20, clientY: 80 });
    await flush();
    const item = menuItem("View Fullscreen");
    if (!item) throw new Error("View Fullscreen item did not render");
    fireEvent.click(item);
    await flush();
    const close = document.body.querySelector<HTMLElement>(
      ".mermaid-view-fullscreen-modal .mermaid-fullscreen-close",
    );
    if (!close) throw new Error("view fullscreen did not open");

    fireEvent.click(close);
    await flush();
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    expect(
      view.container.querySelector(".mermaid-block-editing textarea"),
    ).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
  });

  it("a right-click on the open menu itself neither yields to the browser nor moves it", async () => {
    const { preview } = await mountEditing();
    fireEvent.contextMenu(preview, { clientX: 20, clientY: 80 });
    await flush();
    const open = menu();
    if (!open) throw new Error("menu did not open");

    const nativeMenuAllowed = fireEvent.contextMenu(open, {
      clientX: 25,
      clientY: 90,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(false);
    expect(menu()).toBe(open);
    expect(open.style.left).toBe("20px");
  });
  it("View Fullscreen from the menu shows nothing rather than a stale diagram", async () => {
    // The viewer gets the same fresh-or-nothing svg as the menu items: right
    // after an edit there is no render for the source on screen yet, so the
    // viewer opens on its empty state and fills in when the render lands.
    const { preview, textarea } = await mountEditing();
    fireEvent.change(textarea, { target: { value: EDITED } });
    await flush();
    fireEvent.contextMenu(preview, { clientX: 20, clientY: 80 });
    await flush();
    const item = menuItem("View Fullscreen");
    if (!item) throw new Error("View Fullscreen item did not render");

    fireEvent.click(item);
    await flush();

    const body = ".mermaid-view-fullscreen-body";
    expect(document.body.querySelector(body)).not.toBeNull();
    expect(
      document.body.querySelector(`${body} .mermaid-block-svg`),
    ).toBeNull();
    await waitFor(() => {
      expect(
        document.body.querySelector(`${body} .mermaid-block-svg`),
      ).not.toBeNull();
    });
  });
});
