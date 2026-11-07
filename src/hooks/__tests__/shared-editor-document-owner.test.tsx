// §39 The shared editor holds one tab's document at a time, and `loadedTabId` says whose. The auto-
// save, the source-mode toggle, the plugin surface and the referrer rewrite all trust that answer,
// so a reload written where the tab's document is not, or a name left behind by a tab, puts one
// file's text in another. Real hooks wired as `App.tsx` wires them, a fake IPC, and a gate on the
// parse for the windows that need one. Spec 0076.
import { useRef, useState } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { ProgressiveLoadHandle } from "../../utils/editor/progressive-load";
import type { Editor } from "@tiptap/core";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, string>();
const written: [string, string][] = [];
const parse = vi.hoisted(() => ({ gate: null as null | Promise<void> }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => undefined),
}));
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: (path: string) => Promise.resolve(disk.get(path) ?? ""),
  updateFileIndex: () => Promise.resolve(),
  watchDir: () => Promise.resolve(),
  writeFile: (path: string, content: string) => {
    written.push([path, content]);
    disk.set(path, content);
    return Promise.resolve();
  },
}));
vi.mock("../../pipeline/parse-async", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../pipeline/parse-async")>();
  return {
    ...actual,
    parseMdastAsync: async (text: string) => {
      if (parse.gate) await parse.gate;
      return actual.parseMdastAsync(text);
    },
  };
});

import { makeTestEditor } from "../../__tests__/helpers/make-test-editor";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import {
  clearOriginalDoc,
  isTabLoading,
  loadedTabId,
} from "../../utils/editor/programmatic-update";
import {
  syncCleanSurfacesAfterReferrerRewrite,
  syncOpenSurfacesAfterDiskWrite,
  syncOpenSurfacesAfterFileRewrite,
} from "../../utils/tasks/sync-open-surfaces";
import { useAutoSave } from "../use-auto-save";
import { useEditorEffects } from "../use-editor-effects";
import { triggerAutoReload } from "../use-file-operations";
import {
  createKeepalivePool,
  type KeepalivePool,
} from "../use-large-doc-keepalive";
import { useSourceMode } from "../use-source-mode";
import { useTabSwitching } from "../use-tab-switching";

const NOTE = "/v/note.md";
const COPY = "/v/copy.txt";
const OTHER = "/v/other.md";
const PDF = "/v/a.pdf";
const NOTE_TEXT = "# NOTE\n\nnote body\n";
const COPY_TEXT = "COPY first\n\nCOPY second\n";
const OTHER_TEXT = "# OTHER\n\nother body\n";

const fileTab = (id: string, filePath: string) => ({
  contextId: "c",
  filePath,
  id,
  isDirty: false,
  isPinned: false,
  title: id,
});

let editor: Editor;
let pool: KeepalivePool;

function mountApp() {
  return renderHook(() => {
    const [keepaliveEditor, setKeepaliveEditor] = useState<Editor | null>(null);
    const activeEditor = keepaliveEditor ?? editor;
    const appendHandleRef = useRef<null | {
      handle: ProgressiveLoadHandle;
      tabId: string;
    }>(null);
    const isNavBackForwardRef = useRef(false);
    const scrollOffsets = useRef(new Map<string, number>());
    const source = useSourceMode({
      appendHandleRef,
      editor: activeEditor,
      pool,
    });
    useAutoSave(activeEditor);
    useTabSwitching({
      appendHandleRef,
      createKeepaliveEditor: () => makeTestEditor("<p></p>"),
      editor,
      editorStateCache: source.editorStateCache,
      getSourceBuffer: source.getSourceBuffer,
      isNavBackForwardRef,
      keepalive: pool,
      onActiveEditorChange: setKeepaliveEditor,
      scrollOffsets,
      setFindReplaceMode: vi.fn(),
      setFindReplaceOpen: vi.fn(),
      setIsParsing: vi.fn(),
      setSourceBuffer: source.setSourceBuffer,
      sourceModeTabs: source.sourceModeTabs,
    });
    useEditorEffects({
      editor: activeEditor,
      editorStateCache: source.editorStateCache,
      inlineAI: { applyContent: vi.fn(), previewInsertAfterSelection: vi.fn() },
      setFindReplaceMode: vi.fn(),
      setFindReplaceOpen: vi.fn(),
    });
    return source;
  });
}

const settle = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

const show = (id: string) => {
  act(() => {
    useEditorStore.setState({ activeTabId: id });
  });
};

const installed = (id: string) =>
  waitFor(() => expect(loadedTabId()).toBe(id), { timeout: 5000 });

const loadFinished = (id: string) =>
  waitFor(() => expect(isTabLoading(id)).toBe(false), { timeout: 5000 });

const holdParse = () => {
  let open!: () => void;
  parse.gate = new Promise<void>((resolve) => {
    open = () => {
      parse.gate = null;
      resolve();
    };
  });
  return open;
};

const stale = () => useEditorStore.getState().staleContentTabs;

const paragraphs = (count: number) =>
  Array.from({ length: count }, (_, i) => `line ${i}`);

function duplicatedBlocks(state: Editor["state"]): number {
  const seen = new Map<string, number>();
  state.doc.forEach((node) => {
    seen.set(node.textContent, (seen.get(node.textContent) ?? 0) + 1);
  });
  return [...seen.values()].filter((count) => count > 1).length;
}

function setText(path: string, text: string) {
  disk.set(path, text);
  act(() => useFileStore.getState().setFileContent(path, text));
}

beforeEach(() => {
  disk.clear();
  written.length = 0;
  parse.gate = null;
  editor = makeTestEditor("<p></p>");
  pool = createKeepalivePool();
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: 50 });
  disk.set(NOTE, NOTE_TEXT);
  disk.set(COPY, COPY_TEXT);
  disk.set(OTHER, OTHER_TEXT);
  useFileStore.setState({
    fileMtimes: new Map(),
    openFiles: new Map([
      [COPY, COPY_TEXT],
      [NOTE, NOTE_TEXT],
      [OTHER, OTHER_TEXT],
      [PDF, ""],
    ]),
    rootPath: "/v",
  });
  useEditorStore.setState({
    activeTabId: "t1",
    contentRefreshKey: 0,
    mruOrder: ["t1"],
    sourceBufferAccess: null,
    sourceEditedTabs: [],
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [
      fileTab("t1", NOTE),
      fileTab("t2", COPY),
      fileTab("t3", OTHER),
      fileTab("t4", PDF),
    ],
  });
  for (const id of ["t1", "t2", "t3", "t4"]) clearOriginalDoc(id);
});

afterEach(async () => {
  parse.gate = null;
  act(() => {
    useEditorStore.setState({ activeTabId: null, tabs: [] });
  });
  // With no tab left, the switch empties the editor on a timer that reads its view, and the load's
  // scroll reset waits for a frame that reads it too.
  await waitFor(() => expect(editor.state.doc.textContent).toBe(""));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  pool.destroyAll();
  editor.destroy();
});

describe("a reload reaches only the editor holding that tab's document", () => {
  // What fails these: dropping the check from the §72 refresh effect in `use-editor-effects.ts`.
  it.each(["fresh", "patch"] as const)(
    "%s, on a non-markdown tab: the shared document stays the tab's behind it",
    async (mode) => {
      mountApp();
      await installed("t1");
      show("t2");

      await act(async () => {
        await triggerAutoReload(COPY, 999, { appOrigin: mode === "patch" });
      });
      await settle(20);

      expect(editor.state.doc.textContent).toContain("NOTE");
      expect(editor.state.doc.textContent).not.toContain("COPY");
      // Its document is not in this editor, so no install is coming to take the flag off.
      expect(stale()).toEqual([]);
    },
  );

  // What fails this: dropping the check from the global replace effect. It would empty the editor.
  it("a global replace on a PDF tab leaves the shared document alone", async () => {
    mountApp();
    await installed("t1");
    show("t4");

    act(() => useUIStore.getState().triggerContentReload());
    await settle(20);

    expect(editor.state.doc.textContent).toContain("NOTE");
    expect(stale()).toEqual([]);
  });

  // What fails these: writing into a document still being filled. The rest of the load is then
  // appended behind a document that already has it, 70 blocks twice in a 301-block document.
  // What fails the last two assertions: dropping the re-read after the install.
  it.each(["fresh", "patch"] as const)(
    "%s, during a progressive load: the document ends whole, with the reload in it",
    async (mode) => {
      const lines = paragraphs(300);
      setText(OTHER, lines.join("\n\n") + "\n");
      mountApp();
      await installed("t1");
      show("t3");
      await waitFor(() => expect(isTabLoading("t3")).toBe(true), {
        timeout: 5000,
      });

      disk.set(OTHER, lines.join("\n\n") + "\n\nadded on disk\n");
      await act(async () => {
        await triggerAutoReload(OTHER, 999, { appOrigin: mode === "patch" });
      });
      await loadFinished("t3");
      await settle(20);

      expect(editor.state.doc.childCount).toBe(301);
      expect(duplicatedBlocks(editor.state)).toBe(0);
      expect(editor.state.doc.textContent).toContain("added on disk");
      expect(stale()).toEqual([]);
    },
  );

  it("a keep-alive tab takes the reload in its own editor", async () => {
    setText(OTHER, paragraphs(520).join("\n\n") + "\n");
    mountApp();
    await installed("t1");
    show("t3");
    await installed("t3");
    const before = editor.state;
    expect(pool.isComplete("t3")).toBe(true);

    disk.set(OTHER, paragraphs(520).join("\n\n") + "\n\nadded on disk\n");
    await act(async () => {
      await triggerAutoReload(OTHER, 999);
    });
    await settle(20);

    expect(pool.get("t3")!.state.doc.textContent).toContain("added on disk");
    expect(editor.state).toBe(before);
    expect(stale()).toEqual([]);
  });

  it("a tab in source mode takes it in its buffer and the document behind it", async () => {
    const source = mountApp();
    await installed("t1");
    act(() => source.result.current.toggleSourceMode());

    disk.set(NOTE, "# NOTE\n\nchanged on disk\n");
    await act(async () => {
      await triggerAutoReload(NOTE, 999);
    });
    await settle(20);

    expect(source.result.current.getSourceBuffer("t1")).toBe(
      "# NOTE\n\nchanged on disk\n",
    );
    expect(editor.state.doc.textContent).toContain("changed on disk");
    expect(stale()).toEqual([]);
  });
});

describe("a panel's write to the active tab while its document is on the way", () => {
  // What fails these: dropping the check from the two functions in `sync-open-surfaces.ts`. The
  // text of the tab arriving would go into the document of the tab before it.
  it("a whole-file rewrite waits for the install and is in the document after it", async () => {
    mountApp();
    await installed("t1");
    const open = holdParse();
    show("t3");
    await settle(10);
    const held = editor.state;

    act(() => {
      syncOpenSurfacesAfterFileRewrite(OTHER, "# OTHER\n\nrewritten\n", editor);
    });

    expect(editor.state).toBe(held);
    expect(stale()).toEqual(["t3"]);
    open();
    await installed("t3");
    expect(editor.state.doc.textContent).toContain("rewritten");
    expect(stale()).toEqual([]);
  });

  it("a one-line task write waits for the install and is in the document after it", async () => {
    setText(OTHER, "- [ ] one\n- [ ] two\n");
    mountApp();
    await installed("t1");
    const open = holdParse();
    show("t3");
    await settle(10);
    const held = editor.state;

    act(() => {
      syncOpenSurfacesAfterDiskWrite(
        { line: 1, path: OTHER, raw: "- [ ] two" } as TaskEntry,
        "- [ ] two done",
        editor,
      );
    });

    expect(editor.state).toBe(held);
    open();
    await installed("t3");
    expect(editor.state.doc.textContent).toContain("two done");
    expect(stale()).toEqual([]);
  });

  it("a tab with unsaved work is not flagged, because a flag would drop that work", async () => {
    mountApp();
    await installed("t1");
    const open = holdParse();
    show("t3");
    await settle(10);
    act(() => useEditorStore.getState().markDirty("t3", true));

    act(() => {
      syncOpenSurfacesAfterFileRewrite(OTHER, "# OTHER\n\nrewritten\n", editor);
    });

    expect(stale()).toEqual([]);
    open();
    await installed("t3");
  });
});

describe("leaving a tab takes its name away", () => {
  const AUTO_SAVE_PASSED = 120;

  const type = () => {
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("x", 1));
    });
  };

  // What fails these: dropping `forgetLoadedTab` from the tab switch. The first would write the
  // document from before the reload, which undoes a global replace on disk.
  it("a keystroke while a returning tab parses writes nothing", async () => {
    mountApp();
    await installed("t1");
    show("t2");
    act(() => useUIStore.getState().triggerContentReload());
    await settle(20);
    const open = holdParse();
    show("t1");
    await settle(10);

    expect(loadedTabId()).toBeNull();
    type();
    await settle(AUTO_SAVE_PASSED);

    expect(written).toEqual([]);
    open();
    await installed("t1");
    expect(editor.state.doc.textContent).toContain("NOTE");
  });

  it("a referrer rewrite behind a non-markdown tab survives the return and the next save", async () => {
    mountApp();
    await installed("t1");
    show("t2");
    await settle(10);
    expect(loadedTabId()).toBeNull();

    const rewritten = "# NOTE\n\nnote body [[new-name]]\n";
    disk.set(NOTE, rewritten);
    act(() => {
      syncCleanSurfacesAfterReferrerRewrite(NOTE, rewritten);
    });
    expect(stale()).toEqual(["t1"]);

    show("t1");
    await installed("t1");
    type();
    await settle(AUTO_SAVE_PASSED);

    expect(written).toHaveLength(1);
    expect(written[0][1]).toContain("[[new-name]]");
  });

  it("a large source-mode return names no tab until its fill ends", async () => {
    const source = mountApp();
    await installed("t1");
    act(() => source.result.current.toggleSourceMode());
    await settle(10);
    act(() =>
      source.result.current.setSourceBuffer("t1", paragraphs(700).join("\n\n")),
    );
    show("t3");
    await installed("t3");
    act(() => useFileStore.getState().removeFileEntry(NOTE));
    show("t1");
    await settle(10);

    act(() => source.result.current.toggleSourceMode());
    await waitFor(() =>
      expect(editor.state.doc.textContent.startsWith("line 0")).toBe(true),
    );

    expect(isTabLoading("t1")).toBe(true);
    expect(loadedTabId()).toBeNull();
    await installed("t1");
    expect(editor.state.doc.childCount).toBe(700);
  });

  // What fails these: dropping the restore for a tab with no text. The markdown case would show the
  // tab before it, and the non-markdown case would refuse to save the tab's own document.
  it.each([
    ["a markdown tab", "t3", "OTHER"],
    ["a non-markdown tab", "t2", "COPY"],
  ])(
    "a tab whose file was deleted behind %s comes back with its own document",
    async (_name, between, foreign) => {
      mountApp();
      await installed("t1");
      show(between);
      await settle(20);
      act(() => useFileStore.getState().removeFileEntry(NOTE));

      show("t1");
      await installed("t1");

      expect(editor.state.doc.textContent).toContain("NOTE");
      type();
      await settle(AUTO_SAVE_PASSED);
      expect(written).toHaveLength(1);
      expect(written[0][0]).toBe(NOTE);
      expect(written[0][1]).toContain("NOTE");
      expect(written[0][1]).not.toContain(foreign);
    },
  );

  it("a tab with neither text nor cache is not installed, and a keystroke writes nothing", async () => {
    mountApp();
    await installed("t1");
    show("t3");
    await installed("t3");
    act(() => useUIStore.getState().triggerContentReload());
    await settle(20);
    act(() => useFileStore.getState().removeFileEntry(NOTE));

    show("t1");
    await settle(20);

    expect(loadedTabId()).toBeNull();
    type();
    await settle(AUTO_SAVE_PASSED);
    expect(written).toEqual([]);
  });

  it.each(["fresh", "patch"] as const)(
    "%s reload on a non-markdown tab, then a keystroke on the tab whose file was deleted: its own text is written",
    async (mode) => {
      mountApp();
      await installed("t1");
      show("t2");
      await act(async () => {
        await triggerAutoReload(COPY, 999, { appOrigin: mode === "patch" });
      });
      await settle(20);
      act(() => useFileStore.getState().removeFileEntry(NOTE));

      show("t1");
      await installed("t1");
      type();
      await settle(AUTO_SAVE_PASSED);

      expect(written).toHaveLength(1);
      expect(written[0][0]).toBe(NOTE);
      expect(written[0][1]).not.toContain("COPY");
    },
  );

  it("a tab that is no file (the graph) names nothing, and the way back restores the document", async () => {
    mountApp();
    await installed("t1");

    act(() => useEditorStore.getState().openGraphTab());
    await settle(10);
    expect(loadedTabId()).toBeNull();

    show("t1");
    await installed("t1");
    expect(editor.state.doc.textContent).toContain("NOTE");
  });

  it("a load flagged stale and cancelled by a switch reads the new text on the way back", async () => {
    mountApp();
    await installed("t1");
    const open = holdParse();
    show("t3");
    await settle(10);
    act(() => {
      syncOpenSurfacesAfterFileRewrite(OTHER, "# OTHER\n\nrewritten\n", editor);
    });

    show("t2");
    open();
    await settle(10);
    expect(stale()).toEqual(["t3"]);

    show("t3");
    await installed("t3");
    expect(editor.state.doc.textContent).toContain("rewritten");
    expect(stale()).toEqual([]);
  });

  it("closing a loading tab leaves its flag out of the next tab's install", async () => {
    mountApp();
    await installed("t1");
    const open = holdParse();
    show("t3");
    await settle(10);
    act(() => {
      syncOpenSurfacesAfterFileRewrite(OTHER, "# OTHER\n\nrewritten\n", editor);
    });

    act(() => useEditorStore.getState().closeTab("t3"));
    show("t1");
    open();
    await installed("t1");

    expect(editor.state.doc.textContent).toContain("NOTE");
    expect(editor.state.doc.textContent).not.toContain("rewritten");
    expect(stale()).toEqual([]);
  });
});
