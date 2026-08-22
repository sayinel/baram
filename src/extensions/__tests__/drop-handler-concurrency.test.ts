// §297 fix (I-3 concurrency, final-gate Important #1) — the guarantee
// "two same-named files in one drop/paste don't clobber each other" has to
// be proven at THIS level, not against copyBytesToDir in isolation.
// copyBytesToDir deliberately does not protect concurrent calls from each
// other (see media-copy.test.ts and media-copy.ts's own doc comment); what
// actually prevents the clobber is drop-handler.ts's loops now awaiting
// each file's full read+save+insert before starting the next one, so a
// second same-named file's copyBytesToDir call always runs AFTER the first
// file's write has actually LANDED (and therefore in the mocked listDir
// below).
//
// Mocks only the real IPC boundary (createDir/listDir/writeBinaryFile) —
// unlike drop-handler-video.test.ts, saveMediaToDocAssets/copyBytesToDir
// run for REAL here, because the property under test lives inside that
// chain's interaction with the loop, not in what the loop passes to a mock.
import { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A real Tauri IPC round trip takes real time — the reviewer's finding
// depends on that ("three IPC round trips apart"). Vitest's mocked
// createDir/listDir/writeBinaryFile would otherwise resolve on the very
// next microtask, which finishes file 1's ENTIRE chain before jsdom's real
// FileReader even fires file 2's onload — so a race that is real in
// production never surfaces here without an artificial delay standing in
// for that latency.
const ipcDelay = vi.hoisted(
  () => () => new Promise<void>((resolve) => setTimeout(resolve, 5)),
);

// ‼️ Tracks writes that have actually COMPLETED, separately from
// vi.fn().mock.calls — that array records a call the instant it's invoked,
// not when its returned promise settles. A real filesystem's directory
// listing only reflects a write once it has landed, so `listDir` below
// reads from this array, not from writeBinaryFile.mock.calls (which would
// make two truly concurrent writes look "already visible" to each other
// the moment they start, silently hiding the exact race being tested for).
const landedWrites = vi.hoisted(() => [] as string[]);

const writeBinaryFile = vi.hoisted(() =>
  vi.fn(async (path: string, _bytes: number[]) => {
    await ipcDelay();
    landedWrites.push(path);
  }),
);
const createDirMock = vi.hoisted(() =>
  vi.fn(async () => {
    await ipcDelay();
  }),
);
const listDirMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ name: string }[]> => {
    await ipcDelay();
    return landedWrites.map((path) => ({ name: path.split("/").pop()! }));
  }),
);
const showToast = vi.hoisted(() => vi.fn());

vi.mock("../../ipc/invoke", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/invoke")>();
  return {
    ...actual,
    createDir: createDirMock,
    listDir: listDirMock,
    writeBinaryFile,
  };
});
vi.mock("../../stores/ui/ui", () => ({
  useUIStore: { getState: () => ({ showToast }) },
}));

import { createBaramExtensions } from "..";
import { useEditorStore } from "../../stores/editor/editor";

const DOC_PATH = "/vault/notes/today.md";

function createTestEditor(): Editor {
  return new Editor({ extensions: createBaramExtensions(), content: "" });
}

function makeDropEvent(files: File[]): DragEvent {
  return {
    dataTransfer: { files, getData: () => "" },
    preventDefault: vi.fn(),
    clientX: 0,
    clientY: 0,
  } as unknown as DragEvent;
}

function makePasteEvent(files: File[]): ClipboardEvent {
  return {
    clipboardData: { files, getData: () => "" },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
}

describe("drop-handler concurrency: same-named files in one drop/paste (§297 I-3)", () => {
  beforeEach(() => {
    writeBinaryFile.mockClear();
    createDirMock.mockClear();
    listDirMock.mockClear();
    landedWrites.length = 0;
    showToast.mockClear();
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [{ id: "t1", filePath: DOC_PATH }],
    } as never);
  });

  // Not a doc-node-count assertion: paste inserts via `replaceSelectionWith`
  // (no target position — see insertMediaAtPos), which selects the
  // just-inserted atom, so a second replaceSelectionWith call replaces it —
  // pasting two files into one node is a PRE-EXISTING, separate property of
  // this insertion path, unrelated to I-3 and out of scope here. What I-3
  // actually guarantees is the disk-write level: neither file's bytes are
  // silently discarded by the other's write landing on the same path.
  it("handlePaste: two same-named videos both get their bytes written, at different paths", async () => {
    const editor = createTestEditor();
    const files = [
      new File(["a"], "clip.mp4", { type: "video/mp4" }),
      new File(["b"], "clip.mp4", { type: "video/mp4" }),
    ];
    const event = makePasteEvent(files);

    const handled = editor.view.someProp("handlePaste", (f) =>
      f(editor.view, event, Slice.empty),
    );
    expect(handled).toBe(true);

    await vi.waitFor(() => {
      expect(landedWrites).toHaveLength(2);
    });

    expect(new Set(landedWrites).size).toBe(2);
    expect(showToast).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("handleDrop: two videos with the same name both get their bytes written, at different paths", async () => {
    const editor = createTestEditor();
    const files = [
      new File(["a"], "clip.mp4", { type: "video/mp4" }),
      new File(["b"], "clip.mp4", { type: "video/mp4" }),
    ];
    const event = makeDropEvent(files);
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      pos: 0,
      inside: -1,
    });

    const handled = editor.view.someProp("handleDrop", (f) =>
      f(editor.view, event, Slice.empty, false),
    );
    expect(handled).toBe(true);

    await vi.waitFor(() => {
      expect(landedWrites).toHaveLength(2);
    });

    expect(new Set(landedWrites).size).toBe(2);
    editor.destroy();
  });
});
