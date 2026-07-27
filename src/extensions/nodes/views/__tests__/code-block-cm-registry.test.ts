// §298 Phase 1 (§12-4): CM readOnly Compartment + per-PMView registry.
// NodeView.update() is NOT called when only the PM editable prop changes —
// the vim PluginView broadcasts through the registry instead. These tests
// pin that broadcast path against the REAL CodeBlockNodeView.
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";
import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import {
  broadcastCodeBlockEditable,
  registerCodeBlockEditableSync,
} from "../code-block-cm-registry";

if (typeof window.matchMedia !== "function") {
  window.matchMedia = () =>
    ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
}

declare const MockIntersectionObserver: {
  instances: {
    elements: Set<Element>;
    triggerIntersect: (v?: boolean) => void;
  }[];
};

function createEditor(): Editor {
  return new Editor({ extensions: createBaramExtensions(), content: "" });
}

function loadMarkdown(editor: Editor, md: string): void {
  const doc = markdownToProsemirror(md, editor.schema);
  editor.commands.setContent(doc.toJSON());
}

/** Materialize the lazy CM view and return it. */
async function revealCM(editor: Editor): Promise<CMView> {
  const dom = editor.view.dom as HTMLElement;
  // lazy-visible.ts uses ONE shared module-level observer, and other plugins
  // create their own instances — find the one actually observing this block
  // instead of assuming instances.at(-1).
  const wrapper = dom.querySelector(".code-block-wrapper")!;
  const io = MockIntersectionObserver.instances.find((i) =>
    i.elements.has(wrapper),
  );
  expect(io).toBeDefined();
  io!.triggerIntersect(true);
  await vi.waitFor(() => {
    expect(dom.querySelector(".cm-editor")).not.toBeNull();
  });
  const cm = CMView.findFromDOM(dom.querySelector(".cm-editor") as HTMLElement);
  expect(cm).not.toBeNull();
  return cm!;
}

describe("code block CM readOnly registry (§12-4)", () => {
  it("broadcast toggles a live CM's readOnly facet both ways", async () => {
    const editor = createEditor();
    loadMarkdown(editor, "```ts\nconst x = 1;\n```\n");
    const cm = await revealCM(editor);

    expect(cm.state.facet(CMState.readOnly)).toBe(false);
    broadcastCodeBlockEditable(editor.view, false);
    expect(cm.state.facet(CMState.readOnly)).toBe(true);
    broadcastCodeBlockEditable(editor.view, true);
    expect(cm.state.facet(CMState.readOnly)).toBe(false);

    editor.destroy();
  });

  it("broadcast is scoped to the target PM view (multi-instance isolation)", async () => {
    const a = createEditor();
    loadMarkdown(a, "```\naaa\n```\n");
    const cmA = await revealCM(a);
    const b = createEditor();
    loadMarkdown(b, "```\nbbb\n```\n");
    const cmB = await revealCM(b);

    broadcastCodeBlockEditable(a.view, false);
    expect(cmA.state.facet(CMState.readOnly)).toBe(true);
    expect(cmB.state.facet(CMState.readOnly)).toBe(false);

    a.destroy();
    b.destroy();
  });

  it("broadcast before CM materializes is a no-op; deferred init reads live editable", async () => {
    const editor = createEditor();
    loadMarkdown(editor, "```\nlazy\n```\n");
    // No CM yet — broadcast must not throw and must not force creation.
    broadcastCodeBlockEditable(editor.view, false);
    expect(
      (editor.view.dom as HTMLElement).querySelector(".cm-editor"),
    ).toBeNull();

    // PM editable=false at creation time → CM starts readOnly on its own.
    editor.setEditable(false);
    const cm = await revealCM(editor);
    expect(cm.state.facet(CMState.readOnly)).toBe(true);

    editor.destroy();
  });

  it("destroyed NodeViews unregister — broadcast after destroy does not reach them", () => {
    const calls: boolean[] = [];
    const editor = createEditor();
    const unregister = registerCodeBlockEditableSync(editor.view, (e) =>
      calls.push(e),
    );
    broadcastCodeBlockEditable(editor.view, false);
    expect(calls).toEqual([false]);
    unregister();
    broadcastCodeBlockEditable(editor.view, true);
    expect(calls).toEqual([false]);
    editor.destroy();
    // View no longer registered anywhere — must not throw.
    expect(() => broadcastCodeBlockEditable(editor.view, true)).not.toThrow();
  });
});
