// issue 594 — a block ID rename the backend has committed lands in its
// document wherever that document is: the view that asked, a keep-alive
// editor, the cached EditorState of a background tab, a source-mode buffer,
// the openFiles text, or the file on disk once the tab is closed.
import type { EditorView } from "@tiptap/pm/view";

import { history, undo } from "@tiptap/pm/history";
import { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  readFile: vi.fn(),
  updateFileIndex: vi.fn(async () => ({ fileCount: 0, linkCount: 0 })),
  writeFile: vi.fn(async () => undefined),
}));
vi.mock("../programmatic-update", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../programmatic-update")>()),
  isTabLoading: vi.fn(() => false),
  loadedTabId: vi.fn(() => "t1"),
}));
// The serializer is the pipeline's; here only "the openFiles text follows the
// state" matters, so it is replaced with a legible stand-in.
vi.mock("../serialize-live-doc", () => ({
  serializeEditorState: (state: EditorState) => `md:${idsOf(state).join(",")}`,
}));

import { readFile, updateFileIndex, writeFile } from "../../../ipc/invoke";
import {
  type DocumentSurfaceAccess,
  useEditorStore,
} from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { logger } from "../../logger";
import {
  awaitBlockIdRenames,
  drainPendingBlockIdRenames,
  hasBlockIdRenamesInFlight,
  isBlockIdRenameInFlight,
  landCommittedBlockIdRename,
  prunePendingBlockIdRenames,
  trackBlockIdRename,
} from "../block-id-rename-landing";
import { isTabLoading, loadedTabId } from "../programmatic-update";

const schema = new Schema({
  marks: {},
  nodes: {
    blockReference: {
      atom: true,
      attrs: { blockId: { default: "" }, target: { default: "" } },
      group: "inline",
      inline: true,
    },
    doc: { content: "block+" },
    paragraph: {
      attrs: { blockId: { default: null } },
      content: "inline*",
      group: "block",
    },
    text: { group: "inline" },
  },
});

interface FakeView {
  dispatched: Transaction[];
  state: EditorState;
  view: EditorView;
}

/** `[def, second paragraph (none), ref-to-self, ref-to-other]` block IDs of the fixture document. */
function idsOf(state: EditorState): (null | string)[] {
  const ids: (null | string)[] = [];
  state.doc.descendants((node) => {
    if (node.type.name === "paragraph" || node.type.name === "blockReference") {
      ids.push(node.attrs.blockId as null | string);
    }
    return true;
  });
  return ids;
}

/** A doc: `^old` paragraph, a paragraph referring to it and to another file's `^old`. */
function makeState(withHistory = false): EditorState {
  return EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", { blockId: "old" }, [schema.text("hello")]),
      schema.node("paragraph", null, [
        schema.node("blockReference", { blockId: "old", target: "" }),
        schema.node("blockReference", { blockId: "old", target: "other" }),
      ]),
    ]),
    plugins: withHistory ? [history()] : [],
    schema,
  });
}

function makeView(state: EditorState, keepalive = false): FakeView {
  const holder: FakeView = { dispatched: [], state, view: null as never };
  const dom = document.createElement("div");
  if (keepalive) {
    const host = document.createElement("div");
    host.setAttribute("data-keepalive-editor", "");
    host.appendChild(dom);
  }
  holder.view = {
    dispatch: (tr: Transaction) => {
      holder.dispatched.push(tr);
      holder.state = holder.state.apply(tr);
    },
    dom,
    isDestroyed: false,
    get state() {
      return holder.state;
    },
  } as unknown as EditorView;
  return holder;
}

const OP = {
  filePath: "/vault/note.md",
  newId: "fresh",
  oldId: "old",
  tabId: "t1",
};
const RENAMED = ["fresh", null, "fresh", "old"]; // the other file's ^old stays

const markDirty = vi.fn();
const markSourceEdited = vi.fn();
const setFileContent = vi.fn();
let cache: Map<string, EditorState>;
let pooled: FakeView | null;
let pooledComplete = true;
let access: DocumentSurfaceAccess;

beforeEach(() => {
  vi.mocked(loadedTabId).mockReturnValue("t1");
  vi.mocked(isTabLoading).mockReturnValue(false);
  vi.mocked(readFile).mockReset();
  vi.mocked(writeFile).mockClear();
  markDirty.mockReset();
  markSourceEdited.mockReset();
  setFileContent.mockReset();
  cache = new Map();
  pooled = null;
  pooledComplete = true;
  const shared = makeView(makeState());
  access = {
    editor: { isDestroyed: false, view: shared.view } as never,
    editorStateCache: cache,
    isKeepaliveComplete: () => pooledComplete,
    keepaliveEditor: (tabId) =>
      tabId === "t1" && pooled
        ? ({
            isDestroyed: false,
            get state() {
              return pooled!.state;
            },
            view: pooled.view,
          } as never)
        : null,
  };
  useEditorStore.setState({
    activeTabId: "t1",
    documentSurfaceAccess: access,
    markDirty,
    markSourceEdited,
    sourceBufferAccess: null,
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [
      { filePath: "/vault/note.md", id: "t1", isDirty: false, type: "file" },
      { filePath: "/vault/other.md", id: "t2", isDirty: false, type: "file" },
    ],
  } as never);
  useFileStore.setState({
    openFiles: new Map<string, string>(),
    setFileContent,
  } as never);
  prunePendingBlockIdRenames(new Set());
});

describe("landing in the view that asked", () => {
  it("dispatches into the shared view while it still holds the tab, out of history", async () => {
    const { dispatched, state, view } = makeView(makeState(true));
    // Something to undo, so a history-recorded rename would be visible.
    view.dispatch(state.tr.insertText("!", 6));

    await expect(landCommittedBlockIdRename(OP, view)).resolves.toBe("view");

    expect(idsOf(view.state)).toEqual(RENAMED);
    expect(dispatched.at(-1)!.getMeta("addToHistory")).toBe(false);
    expect(undo(view.state, view.dispatch)).toBe(true); // the "!"
    expect(idsOf(view.state)).toEqual(RENAMED);
    expect(undo(view.state, view.dispatch)).toBe(false);
    // The active tab's own auto-save marks it dirty; nothing to publish here.
    expect(markDirty).not.toHaveBeenCalled();
    expect(setFileContent).not.toHaveBeenCalled();
  });

  it("does not write into the shared view once the tab is on its way out — the cache is the destination", async () => {
    // Tab switch in progress: activeTabId flipped to t2, saveOutgoingTab has
    // cached t1's state, and the shared view still holds t1 until the
    // deferred install. A transaction into that view would be attributed by
    // the auto-save to t2 — and could write t1's document to t2's file.
    const { dispatched, view } = makeView(makeState());
    useEditorStore.setState({ activeTabId: "t2" } as never);
    cache.set("t1", view.state);

    await expect(landCommittedBlockIdRename(OP, view)).resolves.toBe("cache");

    expect(dispatched).toHaveLength(0);
    expect(idsOf(view.state)).toEqual(["old", null, "old", "old"]);
    expect(idsOf(cache.get("t1")!)).toEqual(RENAMED);
    expect(setFileContent).toHaveBeenCalledWith(
      "/vault/note.md",
      "md:fresh,,fresh,old",
    );
    expect(markDirty).toHaveBeenCalledWith("t1", true);
  });

  it("a keep-alive view owns its document whatever tab is active, and publishes when hidden", async () => {
    const { view } = makeView(makeState(), true);
    useEditorStore.setState({ activeTabId: "t2" } as never);
    vi.mocked(loadedTabId).mockReturnValue("t2");

    await expect(landCommittedBlockIdRename(OP, view)).resolves.toBe("view");
    expect(idsOf(view.state)).toEqual(RENAMED);
    // Hidden pooled editor: no auto-save sees its update, so the landing
    // publishes the text and the dirty flag itself.
    expect(setFileContent).toHaveBeenCalledWith(
      "/vault/note.md",
      "md:fresh,,fresh,old",
    );
    expect(markDirty).toHaveBeenCalledWith("t1", true);
  });

  it("does not touch a shared view that has since been given another document", async () => {
    const { dispatched, view } = makeView(makeState()); // "other file" also has ^old
    useEditorStore.setState({ activeTabId: "t2" } as never);
    vi.mocked(loadedTabId).mockReturnValue("t2");
    // …and nothing else holds t1's document either → the text route is next.
    useFileStore.setState({
      openFiles: new Map([["/vault/note.md", "hello ^old\n"]]),
      setFileContent,
    } as never);

    await expect(landCommittedBlockIdRename(OP, view)).resolves.toBe("content");
    expect(dispatched).toHaveLength(0);
  });

  it("does not dispatch into a document still loading — even if the block is already in — but queues", async () => {
    // The first chunk holds the block; the rest is still appending. A
    // transaction now would sit in a partial document that the pool may
    // release, and `saveOutgoingTab` never caches a loading tab.
    const { dispatched, view } = makeView(makeState());
    vi.mocked(isTabLoading).mockReturnValue(true);
    useFileStore.setState({
      openFiles: new Map([["/vault/note.md", "hello ^old\n"]]),
      setFileContent,
    } as never);

    await expect(landCommittedBlockIdRename(OP, view)).resolves.toBe("content");
    expect(dispatched).toHaveLength(0);
    expect(setFileContent).toHaveBeenCalledWith(
      "/vault/note.md",
      "hello ^fresh\n",
    );
    // The load finishes; the content-loaded notification drains the queue
    // into the now complete document.
    vi.mocked(isTabLoading).mockReturnValue(false);
    (access.editor as { view: EditorView }).view = view;
    drainPendingBlockIdRenames("t1");
    expect(idsOf(view.state)).toEqual(RENAMED);
  });

  it("goes to the buffer, not the still-alive ProseMirror document, once the tab is in source mode", async () => {
    // Entering source mode copies the document into a CodeMirror buffer and
    // leaves the PM document in the shared view. The buffer is the truth now.
    const { dispatched, view } = makeView(makeState());
    let buffer = "hello ^old\n\n((#^old))\n";
    useEditorStore.setState({
      sourceBufferAccess: {
        getSourceBuffer: () => buffer,
        setSourceBuffer: (_tabId: string, content: string) => {
          buffer = content;
        },
      },
      sourceModeTabs: ["t1"],
    } as never);

    await expect(landCommittedBlockIdRename(OP, view)).resolves.toBe("source");
    expect(dispatched).toHaveLength(0);
    expect(buffer).toBe("hello ^fresh\n\n((#^fresh))\n");
    expect(markSourceEdited).toHaveBeenCalledWith("t1", true);
  });

  it("reports a block that is simply gone", async () => {
    const warns = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { view } = makeView(
      EditorState.create({
        doc: schema.node("doc", null, [schema.node("paragraph")]),
        schema,
      }),
    );
    await expect(landCommittedBlockIdRename(OP, view)).resolves.toBe("dropped");
    expect(warns).toHaveBeenCalled();
    warns.mockRestore();
  });
});

describe("landing behind another tab", () => {
  beforeEach(() => {
    useEditorStore.setState({ activeTabId: "t2" } as never);
    vi.mocked(loadedTabId).mockReturnValue("t2");
  });

  it("applies to the cached EditorState, keeping the typing done before the switch and its history", async () => {
    const before = makeState(true);
    const typed = before.apply(before.tr.insertText("!", 6));
    cache.set("t1", typed);

    await expect(landCommittedBlockIdRename(OP)).resolves.toBe("cache");

    const after = cache.get("t1")!;
    expect(after.doc.child(0).textContent).toBe("hello!");
    expect(idsOf(after)).toEqual(RENAMED);
    expect(setFileContent).toHaveBeenCalledWith(
      "/vault/note.md",
      "md:fresh,,fresh,old",
    );
    expect(markDirty).toHaveBeenCalledWith("t1", true);
    // Undo after the tab comes back takes the "!" — never the rename.
    let state = after;
    expect(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.child(0).textContent).toBe("hello");
    expect(idsOf(state)).toEqual(RENAMED);
  });

  it("dispatches into a hidden keep-alive editor and publishes its text and dirty flag itself", async () => {
    pooled = makeView(makeState());

    await expect(landCommittedBlockIdRename(OP)).resolves.toBe("keepalive");

    expect(idsOf(pooled.state)).toEqual(RENAMED);
    expect(setFileContent).toHaveBeenCalledWith(
      "/vault/note.md",
      "md:fresh,,fresh,old",
    );
    expect(markDirty).toHaveBeenCalledWith("t1", true);
  });

  it("does not trust the cached document of a tab flagged stale — the text is the authority", async () => {
    // The file changed on disk while the tab was in the background (a task
    // write, a sync); openFiles has that newer text and the cache is dropped
    // on return. Applying to the cache and serializing it would stamp the old
    // document over the newer text.
    cache.set("t1", makeState());
    useEditorStore.setState({ staleContentTabs: ["t1"] } as never);
    useFileStore.setState({
      openFiles: new Map([["/vault/note.md", "newer text ^old\n"]]),
      setFileContent,
    } as never);

    await expect(landCommittedBlockIdRename(OP)).resolves.toBe("content");
    expect(idsOf(cache.get("t1")!)).toEqual(["old", null, "old", "old"]);
    expect(setFileContent).toHaveBeenCalledWith(
      "/vault/note.md",
      "newer text ^fresh\n",
    );
  });

  it("does not trust an incomplete keep-alive entry, and lands in it once the load marks it complete", async () => {
    pooled = makeView(makeState());
    pooledComplete = false;
    useFileStore.setState({
      openFiles: new Map([["/vault/note.md", "hello ^old\n"]]),
      setFileContent,
    } as never);

    await expect(landCommittedBlockIdRename(OP)).resolves.toBe("content");
    expect(pooled.dispatched).toHaveLength(0);
    expect(setFileContent).toHaveBeenCalledWith(
      "/vault/note.md",
      "hello ^fresh\n",
    );

    // The cold load finishes: `markComplete` comes BEFORE the content-loaded
    // notification (load-tab-content.ts), so the drain trusts the document.
    pooledComplete = true;
    drainPendingBlockIdRenames("t1");
    expect(idsOf(pooled.state)).toEqual(RENAMED);
  });

  it("rewrites a source-mode tab's buffer and marks it edited", async () => {
    let buffer = "hello ^old\n\n((#^old)) ((other#^old))\n";
    useEditorStore.setState({
      sourceBufferAccess: {
        getSourceBuffer: () => buffer,
        setSourceBuffer: (_tabId: string, content: string) => {
          buffer = content;
        },
      },
      sourceModeTabs: ["t1"],
    } as never);

    await expect(landCommittedBlockIdRename(OP)).resolves.toBe("source");
    expect(buffer).toBe("hello ^fresh\n\n((#^fresh)) ((other#^old))\n");
    expect(markSourceEdited).toHaveBeenCalledWith("t1", true);
  });

  it("rewrites the openFiles text when no document object exists, and re-checks once one is installed", async () => {
    useFileStore.setState({
      openFiles: new Map([["/vault/note.md", "hello ^old\n"]]),
      setFileContent,
    } as never);

    await expect(landCommittedBlockIdRename(OP)).resolves.toBe("content");
    expect(setFileContent).toHaveBeenCalledWith(
      "/vault/note.md",
      "hello ^fresh\n",
    );
    expect(markDirty).toHaveBeenCalledWith("t1", true);

    // The tab comes back; the parsed document already says ^fresh — the
    // queued entry finds nothing to do and says nothing.
    const warns = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const installed = makeView(makeState());
    installed.view.dispatch(
      installed.state.tr.setNodeMarkup(0, undefined, { blockId: "fresh" }),
    );
    (access.editor as { view: EditorView }).view = installed.view;
    vi.mocked(loadedTabId).mockReturnValue("t1");
    drainPendingBlockIdRenames("t1");
    expect(installed.dispatched).toHaveLength(1); // only our own setNodeMarkup
    warns.mockRestore();
  });
});

describe("landing on disk", () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeTabId: "t2",
      tabs: [{ filePath: "/vault/other.md", id: "t2", type: "file" }],
    } as never);
    vi.mocked(loadedTabId).mockReturnValue("t2");
  });

  it("rewrites the saved file of a tab that was closed within the round trip, and re-indexes it", async () => {
    vi.mocked(readFile).mockResolvedValue("hello ^old\n\n((#^old))\n");
    await expect(landCommittedBlockIdRename(OP)).resolves.toBe("disk");
    expect(writeFile).toHaveBeenCalledWith(
      "/vault/note.md",
      "hello ^fresh\n\n((#^fresh))\n",
    );
    // The app's own write keeps the watcher quiet, so the index is told here.
    expect(updateFileIndex).toHaveBeenCalledWith("/vault/note.md");
  });

  it("writes nothing when the file no longer has the block", async () => {
    const warns = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.mocked(readFile).mockResolvedValue("no block here\n");
    await expect(landCommittedBlockIdRename(OP)).resolves.toBe("dropped");
    expect(writeFile).not.toHaveBeenCalled();
    warns.mockRestore();
  });

  it("reports a file it could not read or write", async () => {
    const warns = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
    await expect(landCommittedBlockIdRename(OP)).resolves.toBe("dropped");
    expect(warns.mock.calls[0]![0]).toContain("ENOENT");
    warns.mockRestore();
  });
});

describe("the pending queue", () => {
  it("forgets the renames of tabs that are no longer open", () => {
    const { view } = makeView(
      EditorState.create({
        doc: schema.node("doc", null, [schema.node("paragraph")]),
        schema,
      }),
    );
    vi.mocked(isTabLoading).mockReturnValue(true);
    void landCommittedBlockIdRename(OP, view);
    prunePendingBlockIdRenames(new Set(["t2"]));
    // Nothing left to drain: the loaded document is untouched.
    const loaded = makeView(makeState());
    (access.editor as { view: EditorView }).view = loaded.view;
    vi.mocked(isTabLoading).mockReturnValue(false);
    drainPendingBlockIdRenames("t1");
    expect(loaded.dispatched).toHaveLength(0);
  });
});

describe("in-flight renames and the save paths", () => {
  it("awaitBlockIdRenames resolves once the tab's tracked chains have settled", async () => {
    let finish!: () => void;
    const chain = new Promise<void>((r) => {
      finish = r;
    });
    expect(hasBlockIdRenamesInFlight("t1")).toBe(false);
    trackBlockIdRename("t1", { newId: "fresh", oldId: "old" }, chain);
    expect(hasBlockIdRenamesInFlight("t1")).toBe(true);
    expect(hasBlockIdRenamesInFlight()).toBe(true);
    expect(isBlockIdRenameInFlight("t1", "old")).toBe(true);
    expect(isBlockIdRenameInFlight("t1", "fresh")).toBe(true);
    expect(isBlockIdRenameInFlight("t1", "other")).toBe(false);
    expect(isBlockIdRenameInFlight("t2", "old")).toBe(false);
    let settled = false;
    const waiting = awaitBlockIdRenames("t1").then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await waiting;
    expect(settled).toBe(true);
    // Forgotten once settled: the next wait is immediate, the lock is gone.
    await expect(awaitBlockIdRenames("t1")).resolves.toBeUndefined();
    expect(isBlockIdRenameInFlight("t1", "old")).toBe(false);
    expect(hasBlockIdRenamesInFlight("t1")).toBe(false);
  });

  it("awaits nothing for a tab with no rename in flight", async () => {
    await expect(awaitBlockIdRenames("t9")).resolves.toBeUndefined();
    await expect(awaitBlockIdRenames()).resolves.toBeUndefined();
  });
});
