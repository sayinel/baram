// §339 — CodeBlockNodeView (the one CLASS-based, plain-ProseMirror NodeView
// among the six that carry a ✨ AI button) hides that button when the AI
// kill switch is off, and reacts LIVE to a toggle — this class has no React
// re-render to piggyback on, so it subscribes to the store directly
// (code-block-node-view.ts, mirroring its own pre-existing `settingsUnsub`
// pattern for other settings that affect this same chrome).
//
// This is the "render" half of the completeness pair described in
// `utils/__tests__/nodeview-ai-gate.test.ts` (that file's source scan proves
// every call site MENTIONS `aiEnabled`; this proves the gate actually hides
// the button, keeps the language selector, and updates without a remount).
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../..";
import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { useAIStore } from "../../../../stores/ai/ai";

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

/** Reveal the block so CodeMirror mounts — mirrors code-block-vim-wiring's
 *  `revealCM`, though the AI button itself is created synchronously in the
 *  NodeView constructor and does not depend on this. */
function reveal(): void {
  for (const io of MockIntersectionObserver.instances) {
    io.triggerIntersect(true);
  }
}

describe("CodeBlockNodeView hides its AI button when AI is off (§339, real render)", () => {
  it("the button is hidden and the language selector survives", () => {
    useAIStore.setState({ aiEnabled: false });
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    try {
      reveal();
      const dom = editor.view.dom as HTMLElement;
      const aiBtn = dom.querySelector<HTMLButtonElement>(".code-block-ai-btn");
      expect(aiBtn).not.toBeNull();
      expect(aiBtn?.hidden).toBe(true);
      // AI-unrelated chrome must survive the gate.
      expect(dom.querySelector(".code-block-lang-select")).not.toBeNull();
    } finally {
      editor.destroy();
      useAIStore.setState({ aiEnabled: true }); // restore the default for other files
    }
  });

  it("shows the button when aiEnabled is true", () => {
    useAIStore.setState({ aiEnabled: true });
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    try {
      reveal();
      const dom = editor.view.dom as HTMLElement;
      const aiBtn = dom.querySelector<HTMLButtonElement>(".code-block-ai-btn");
      expect(aiBtn?.hidden).toBe(false);
    } finally {
      editor.destroy();
    }
  });

  it("reacts LIVE to a toggle — no remount needed", () => {
    useAIStore.setState({ aiEnabled: true });
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    try {
      reveal();
      const dom = editor.view.dom as HTMLElement;
      const aiBtn = dom.querySelector<HTMLButtonElement>(".code-block-ai-btn");
      expect(aiBtn?.hidden).toBe(false);

      useAIStore.setState({ aiEnabled: false });
      expect(aiBtn?.hidden).toBe(true);

      useAIStore.setState({ aiEnabled: true });
      expect(aiBtn?.hidden).toBe(false);
    } finally {
      editor.destroy();
    }
  });

  it("unsubscribes on destroy — a toggle after destroy touches nothing", () => {
    useAIStore.setState({ aiEnabled: true });
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    reveal();
    editor.destroy();
    // Must not throw — the subscription was torn down in destroy().
    expect(() => useAIStore.setState({ aiEnabled: false })).not.toThrow();
    useAIStore.setState({ aiEnabled: true });
  });
});
