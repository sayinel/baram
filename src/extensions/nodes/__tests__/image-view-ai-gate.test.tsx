// §339 — ImageView (a functional/React NodeView) hides its ✨ AI button when
// the AI kill switch is off, while the rest of its hover chrome — caption
// and view-original, which are NOT AI features — stays on screen.
//
// This is the "render" half of the completeness pair described in
// `utils/__tests__/nodeview-ai-gate.test.ts`: that file's source scan proves
// every call site MENTIONS `aiEnabled`, which is weaker than proving the
// gate actually hides the button and leaves everything else alone. This
// mounts the real component (fixture reused from block-chrome-i18n.test.tsx,
// already proven to mount ImageView) and reads the DOM.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(),
}));

vi.mock("../../plugins/vim/vim-keys", () => ({
  updateNodeAttributesWithVim: vi.fn(),
}));

vi.mock("../../../stores/editor/editor", () => ({
  useEditorStore: {
    getState: () => ({
      activeTabId: "t1",
      tabs: [{ filePath: "/vault/notes/today.md", id: "t1" }],
    }),
  },
}));

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({
    children,
    className,
    ref,
  }: {
    children: React.ReactNode;
    className?: string;
    ref?: React.Ref<HTMLDivElement>;
  }) => (
    <div className={className} ref={ref}>
      {children}
    </div>
  ),
}));

import type { NodeViewProps } from "@tiptap/react";

import en from "../../../i18n/en.json";
import { useAIStore } from "../../../stores/ai/ai";
import { ImageView } from "../image-view";

function mountImageView() {
  const props = {
    editor: {},
    getPos: () => 0,
    node: { attrs: { alt: "", src: "assets/2026-09/photo.png", title: "" } },
    selected: false,
    updateAttributes: () => undefined,
  } as unknown as NodeViewProps;
  return render(<ImageView {...props} />);
}

afterEach(() => {
  cleanup();
  useAIStore.setState({ aiEnabled: true }); // restore the default for other files
});

describe("ImageView hides its AI button when AI is off (§339, real render)", () => {
  it("removes the Sparkles button but keeps caption/view-original", () => {
    useAIStore.setState({ aiEnabled: false });
    const { getByLabelText, queryByLabelText } = mountImageView();

    expect(queryByLabelText(en["toolbar.ai.commands"])).toBeNull();
    // AI-unrelated chrome must survive the gate — a regression here would be
    // the toolbar losing buttons it never should have lost.
    expect(getByLabelText(en["blockChrome.caption"])).toBeInTheDocument();
    expect(getByLabelText(en["blockChrome.viewOriginal"])).toBeInTheDocument();
  });

  it("shows the Sparkles button when aiEnabled is true", () => {
    useAIStore.setState({ aiEnabled: true });
    const { getByLabelText } = mountImageView();

    expect(getByLabelText(en["toolbar.ai.commands"])).toBeInTheDocument();
    expect(getByLabelText(en["blockChrome.caption"])).toBeInTheDocument();
    expect(getByLabelText(en["blockChrome.viewOriginal"])).toBeInTheDocument();
  });
});
