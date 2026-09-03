// issue 521 — the mermaid block has ONE right-click menu: its own.
//
// Two menus existed. The NodeView's local menu (MermaidBlockContextMenu) is
// what the user sees in preview state; it stops propagation, so the
// document-level ContextMenu never saw those clicks. But the local handler is
// attached only while NOT editing — with the textarea open, a right-click
// bubbled to the document listener, whose mermaid branch then showed a
// "diagram" menu over the textarea, including a Copy-as-PNG that handed
// rendered SVG markup to a function expecting mermaid source. The
// document-level path is removed; this file pins both states.
//
// Mounted through a real editor + the real <ContextMenu>, with mermaid's
// renderer mocked as in export-heavy-blocks.test.tsx.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { createBaramExtensions } from "../../../extensions";
import { ContextMenu } from "../ContextMenu";

const MERMAID_ONLY_ITEMS = [
  "Copy as PNG",
  "Edit Full-screen",
  "Delete Diagram",
];

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mountMermaidDoc() {
  const editor = new Editor({ extensions: createBaramExtensions() });
  editors.push(editor);
  const view = render(
    <>
      <EditorContent editor={editor} />
      <ContextMenu editor={editor} />
    </>,
  );
  act(() => {
    editor.commands.setContent({
      content: [
        { attrs: { code: "flowchart LR\n  A --> B" }, type: "mermaidBlock" },
        { type: "paragraph" },
      ],
      type: "doc",
    });
  });
  await flush();
  const wrapper = view.container.querySelector<HTMLElement>(
    '[data-type="mermaidBlock"]',
  );
  if (!wrapper) throw new Error("mermaid block did not mount");
  return { editor, view, wrapper };
}

/** Labels of every item the document-level menu currently shows. */
function documentMenuLabels(): string[] {
  return [...document.querySelectorAll(".context-menu .context-menu-item")].map(
    (el) => el.textContent?.trim() ?? "",
  );
}

function localMenuOpen(): boolean {
  return document.querySelector(".mermaid-context-menu") !== null;
}

describe("mermaid block context menu ownership (issue 521)", () => {
  it("preview: right-click opens the block's own menu and never the document-level one", async () => {
    const { wrapper } = await mountMermaidDoc();

    fireEvent.contextMenu(wrapper, { clientX: 20, clientY: 20 });
    await flush();

    expect(localMenuOpen()).toBe(true);
    expect(documentMenuLabels()).toEqual([]);
  });

  it("editing: right-click on the textarea is left to the browser — no menu of ours, native one allowed", async () => {
    // The local handler is detached while editing, so this click DOES reach
    // the document listener. Before the fix that produced the mermaid items
    // (with the broken Copy-as-PNG). Now the listener recognises a native
    // form control and steps aside without preventDefault, so the browser's
    // own textarea menu (copy / paste / spellcheck) is what the user gets.
    // Vim is off in this editor, so a NodeSelection alone opens the editing
    // session (with vim modal it would be a preview traversal).
    const { editor, view } = await mountMermaidDoc();
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    await flush();
    const textarea = view.container.querySelector<HTMLTextAreaElement>(
      '[data-type="mermaidBlock"] textarea',
    );
    if (!textarea) throw new Error("editing textarea did not mount");

    const nativeMenuAllowed = fireEvent.contextMenu(textarea, {
      clientX: 20,
      clientY: 20,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(true);
    expect(localMenuOpen()).toBe(false);
    expect(documentMenuLabels()).toEqual([]);
    for (const item of MERMAID_ONLY_ITEMS) {
      expect(document.body.textContent).not.toContain(item);
    }
  });

  it("control: a right-click on ordinary text is still intercepted by the document-level menu", async () => {
    // The step-aside rule is narrow — native text controls only. Everywhere
    // else the document listener keeps owning the right-click, so a
    // regression that widened the bail-out would show up here.
    const { view } = await mountMermaidDoc();
    const paragraph = view.container.querySelector<HTMLElement>("p");
    if (!paragraph) throw new Error("paragraph did not mount");

    const nativeMenuAllowed = fireEvent.contextMenu(paragraph, {
      clientX: 20,
      clientY: 200,
    });

    expect(nativeMenuAllowed).toBe(false);
  });

  it("control: the task item's control is a <button>, not a text control — still intercepted", async () => {
    // Pins the boundary of the rule from the other side: a NodeView control
    // that is not a text input keeps the document menu. (A rule like "bail
    // out for every non-mermaid NodeView" would fail here.)
    const editor = new Editor({ extensions: createBaramExtensions() });
    editors.push(editor);
    const view = render(
      <>
        <EditorContent editor={editor} />
        <ContextMenu editor={editor} />
      </>,
    );
    act(() => {
      editor.commands.setContent({
        content: [
          {
            content: [
              {
                attrs: { checked: false },
                content: [
                  {
                    content: [{ text: "todo", type: "text" }],
                    type: "paragraph",
                  },
                ],
                type: "taskItem",
              },
            ],
            type: "taskList",
          },
        ],
        type: "doc",
      });
    });
    await flush();
    const control = view.container.querySelector<HTMLElement>(
      "button.task-checkbox",
    );
    if (!control) throw new Error("task control did not mount");

    expect(fireEvent.contextMenu(control, { clientX: 5, clientY: 5 })).toBe(
      false,
    );
  });

  it("stepping aside also closes a document-level menu that was already open", async () => {
    // Open the document menu first, then right-click the mermaid textarea:
    // the native menu is allowed AND our menu must not linger beside it as
    // a ghost. jsdom has no layout, so posAtCoords — the only piece of the
    // generic branch that needs geometry — is stubbed to point into the
    // paragraph; everything else runs for real.
    const { editor, view } = await mountMermaidDoc();
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    await flush();
    const textarea = view.container.querySelector<HTMLTextAreaElement>(
      '[data-type="mermaidBlock"] textarea',
    );
    const paragraph = view.container.querySelector<HTMLElement>("p");
    if (!textarea || !paragraph) throw new Error("fixture did not mount");
    const paragraphPos = editor.state.doc.content.size - 1;
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      inside: paragraphPos - 1,
      pos: paragraphPos,
    });

    fireEvent.contextMenu(paragraph, { clientX: 20, clientY: 200 });
    await flush();
    expect(documentMenuLabels().length).toBeGreaterThan(0);

    const nativeMenuAllowed = fireEvent.contextMenu(textarea, {
      clientX: 20,
      clientY: 20,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(true);
    expect(documentMenuLabels()).toEqual([]);
  });
});
