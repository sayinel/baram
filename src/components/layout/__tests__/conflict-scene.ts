// §3.6 Shared scene for the conflict-target tests. The module mocks live in each
// test file (vi.mock is hoisted per file); this holds the store setup and a fake
// disk the mocked `readFile`/`writeFile` read and write.
//
// Scene S: the active tab b holds "B body" in the shared editor and is dirty;
// the background tab a is dirty with "A local" in its cached EditorState and in
// `openFiles`; c is a second background dirty tab. The disk holds "EXT1" for a.
import type { EditorTab } from "../../../stores/editor/editor";
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

import { makeTestEditor } from "../../../__tests__/helpers/make-test-editor";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import {
  clearOriginalDoc,
  markContentLoaded,
  setDocumentOwner,
  setTabLoading,
} from "../../../utils/editor/programmatic-update";
import { serializeLiveDoc } from "../../../utils/editor/serialize-live-doc";

export const A = "/v/a.md";
export const A2 = "/v/a2.md";
export const B = "/v/b.md";
export const C = "/v/c.md";
export const NOW = 4000;

export const disk = new Map<string, string>();
export const buffers = new Map<string, string>();
export const cache = new Map<string, EditorState>();

export interface Deferred<T> {
  promise: Promise<T>;
  reject: (err: unknown) => void;
  resolve: (value: T) => void;
}

export interface Scene {
  shared: Editor;
}

let shared: Editor | null = null;

/** The cached EditorState of a background tab, parsed from `html`. */
export function cacheTab(tabId: string, html: string): void {
  const source = makeTestEditor(html);
  cache.set(tabId, source.state);
  source.destroy();
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

export const fileTab = (
  id: string,
  filePath: string,
  isDirty = true,
): EditorTab => ({
  contextId: "c",
  filePath,
  id,
  isDirty,
  isPinned: false,
  title: filePath.split("/").pop()!,
});

export const isDirty = (id: string): boolean | undefined =>
  useEditorStore.getState().tabs.find((t) => t.id === id)?.isDirty;

export const queueIds = (): string[] =>
  useUIStore.getState().conflictQueue.map((e) => e.tabId);

/** Build scene S. Returns the shared editor (destroy it with `teardownScene`). */
export function setupScene(): Scene {
  disk.clear();
  buffers.clear();
  cache.clear();
  disk.set(A, "EXT1\n");
  disk.set(B, "B old\n");
  disk.set(C, "C disk\n");
  shared = makeTestEditor("<p>B body</p>");
  markContentLoaded("b");
  setDocumentOwner(shared, "b");
  cacheTab("a", "<p>A local</p>");
  cacheTab("c", "<p>C local</p>");

  useUIStore.setState({ conflictQueue: [], toast: null });
  useFileStore.setState({
    fileMtimes: new Map([
      [A, { canReloadMtime: 0, lastSaveMtime: 1000 }],
      [C, { canReloadMtime: 0, lastSaveMtime: 1000 }],
    ]),
    fileTree: [],
    openFiles: new Map([
      [A, "A local\n"],
      [B, "B old\n"],
      [C, "C local\n"],
    ]),
  });
  useEditorStore.setState({
    activeTabId: "b",
    documentSurfaceAccess: {
      editor: shared,
      editorStateCache: cache,
      isKeepaliveComplete: () => true,
      keepaliveEditor: () => null,
    },
    mruOrder: [],
    sourceBufferAccess: {
      getSourceBuffer: (id) => buffers.get(id) ?? "",
      hasSourceBuffer: (id) => buffers.has(id),
      setSourceBuffer: (id, content) => {
        buffers.set(id, content);
      },
    },
    sourceEditedTabs: [],
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [fileTab("a", A), fileTab("b", B), fileTab("c", C)],
  });
  return { shared };
}

export const sharedText = (): string => serializeLiveDoc(shared!);

export function teardownScene(): void {
  for (const id of ["a", "a-dup", "a2-new", "a-new", "b", "c"]) {
    setTabLoading(id, false);
    clearOriginalDoc(id);
  }
  shared?.destroy();
  shared = null;
}
