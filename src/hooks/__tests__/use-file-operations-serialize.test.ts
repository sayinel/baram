// §384 real-path pin — `handleSave` must write byte-identical markdown when the
// caret sits inside a SyntaxReveal expansion (e.g. a link mid-edit). This is the
// one pin in the #384 fix that proves the WIRING, not just the `serializeLiveDoc`
// engine (already covered unit-level in `utils/editor/__tests__/serialize-live-doc.test.ts`):
// it renders the real `useFileOperations` hook and inspects the bytes actually
// handed to `writeFile`. Harness modeled on `auto-save-reload-baseline.test.ts`.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.fn(async (_path: string, _content: string) => {});
const updateFileIndex = vi.fn(async (_path: string) => {});

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: (path: string) => updateFileIndex(path),
  writeFile: (path: string, content: string) => writeFile(path, content),
}));

import { Editor } from "@tiptap/core";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useFileOperations } from "../use-file-operations";

const PATH = "/v/a.md";
const TAB = "t1";
const ORIGINAL = "Hello [world](https://example.com) end\n";

beforeEach(() => {
  writeFile.mockClear();
  updateFileIndex.mockClear();

  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  useEditorStore.setState({
    activeTabId: TAB,
    mruOrder: [],
    sourceModeTabs: [],
    tabs: [
      {
        contextId: "c",
        filePath: PATH,
        id: TAB,
        isDirty: true,
        isPinned: false,
        title: "a",
      },
    ],
  });
});

describe("§384 handleSave writes canonical bytes, not a mid-expansion literal", () => {
  it("caret inside a link at save time: writeFile receives the ORIGINAL markdown, unmodified", async () => {
    const editor = new Editor({ extensions: createBaramExtensions() });
    const doc = markdownToProsemirror(ORIGINAL, editor.schema);
    editor.commands.setContent(doc.toJSON());

    // Move the caret inside "world" — mirrors the two-step guard-then-target
    // hop `syntax-reveal.test.ts` uses; this actually expands the link to
    // literal `[world](https://example.com)` text in the live document.
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.setTextSelection(9);
    });

    const ops = renderHook(() =>
      useFileOperations({
        editor,
        getSourceBuffer: () => "",
        sourceModeTabs: new Set(),
      }),
    );

    await act(async () => {
      await ops.result.current.handleSave();
    });

    expect(writeFile).toHaveBeenCalledWith(PATH, ORIGINAL);

    ops.unmount();
    editor.destroy();
  });
});
