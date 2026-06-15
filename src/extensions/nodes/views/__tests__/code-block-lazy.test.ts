// §perf-large-file: CodeBlock lazy CodeMirror instantiation tests
// Verifies that CodeMirror is NOT created at mount time, only after the
// block's wrapper element enters the viewport (IntersectionObserver fires).
import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";
import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";

// jsdom does not implement window.matchMedia — polyfill for getHighlightStyle()
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

function createEditor(): Editor {
  return new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
}

function loadMarkdown(editor: Editor, md: string): void {
  const doc = markdownToProsemirror(md, editor.schema);
  editor.commands.setContent(doc.toJSON());
}

describe("CodeBlock lazy CodeMirror (§perf-large-file)", () => {
  it("does not create a CodeMirror view until the block is visible", async () => {
    const editor = createEditor();
    loadMarkdown(editor, "```ts\nconst x = 1;\n```\n");

    const dom = editor.view.dom as HTMLElement;

    // Before intersection: placeholder present, no cm-editor
    expect(dom.querySelector(".cm-editor")).toBeNull();
    expect(dom.querySelector(".code-block-placeholder")).not.toBeNull();

    // Trigger IntersectionObserver for the most-recently-registered instance
    MockIntersectionObserver.instances.at(-1)!.triggerIntersect(true);

    // initCM is async (awaits language extension + new CMView construction).
    // Poll for completion instead of a fixed sleep — a fixed 50ms timeout was
    // flaky under parallel-test load when initCM took longer.
    await vi.waitFor(() => {
      expect(dom.querySelector(".cm-editor")).not.toBeNull();
    });

    // After intersection: cm-editor exists, placeholder replaced
    expect(dom.querySelector(".code-block-placeholder")).toBeNull();

    editor.destroy();
  });

  it("placeholder text matches the code block content", () => {
    const editor = createEditor();
    loadMarkdown(editor, "```\nhello world\n```\n");

    const dom = editor.view.dom as HTMLElement;
    const ph = dom.querySelector(".code-block-placeholder") as HTMLElement;
    expect(ph).not.toBeNull();
    expect(ph.textContent).toBe("hello world");

    editor.destroy();
  });
});
