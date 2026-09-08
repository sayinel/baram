// issue 594 — a block ID rename changes the document only after the backend
// has renamed the references in other files.
//
// It used to be the other way round: the attribute was set, then
// `rename_block_id` was called. When the backend refused (file outside every
// context, link index unreadable) the document said `new`, every other file
// said `old`, and `old` was gone from the editor — the edit could not be
// retried. Now a refusal leaves the document untouched, and the same edit
// simply works once the reason is gone.
//
// issue 263 (kept): the failure toast belongs to the IPC rejection only —
// `.then(onFulfilled, onRejected)`, never `.then(...).catch(...)`, so a throw
// from the success body cannot be reported as "the backend refused".
import type { Transaction } from "@tiptap/pm/state";

import { history, undo } from "@tiptap/pm/history";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  readFile: vi.fn(async () => "reloaded"),
  renameBlockId: vi.fn(),
  updateFileIndex: vi.fn(async () => undefined),
}));
vi.mock(
  "../../../utils/editor/programmatic-update",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../utils/editor/programmatic-update")
    >()),
    loadedTabId: vi.fn(() => "t1"),
  }),
);

import type { EditorView } from "@tiptap/pm/view";

import { renameBlockId } from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import { loadedTabId } from "../../../utils/editor/programmatic-update";
import { logger } from "../../../utils/logger";
import {
  blockIdDecoKey,
  commitBlockIdEdit,
  createEditWidget,
} from "../block-id-widgets";

const schema = new Schema({
  marks: {},
  nodes: {
    blockReference: {
      atom: true,
      attrs: { blockId: { default: null } },
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

interface TestView {
  /** Every transaction dispatched, in order. */
  dispatched: Transaction[];
  focus: ReturnType<typeof vi.fn>;
  view: EditorView;
}

function activeTab(filePath: string | undefined): void {
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [
      {
        contextId: "c1",
        filePath,
        id: "t1",
        isDirty: false,
        isPinned: false,
        title: "note.md",
        type: "file",
      },
    ],
  } as never);
}

function blockIds(view: EditorView): (null | string)[] {
  const ids: (null | string)[] = [];
  view.state.doc.descendants((node) => {
    if (node.type.name === "paragraph" || node.type.name === "blockReference") {
      ids.push(node.attrs.blockId as null | string);
    }
    return true;
  });
  return ids;
}

/** Let the IPC promise and the `await readFile` inside its body settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * The narrow slice of `EditorView` `commitBlockIdEdit` touches: a state to
 * read the node from, a dispatch that applies the transaction, `focus`, and
 * `isDestroyed`. The doc: a paragraph `^old` followed by a paragraph holding a
 * same-document reference to it.
 */
function makeView(): TestView {
  let state = EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", { blockId: "old" }, [schema.text("hello")]),
      schema.node("paragraph", null, [
        schema.text("see "),
        schema.node("blockReference", { blockId: "old" }),
      ]),
    ]),
    // The real history plugin: the undo cases below are about what Undo
    // does to a rename the backend has already applied elsewhere.
    plugins: [history()],
    schema,
  });
  const dispatched: Transaction[] = [];
  const focus = vi.fn();
  const view = {
    dispatch: (tr: Transaction) => {
      dispatched.push(tr);
      state = state.apply(tr);
    },
    focus,
    isDestroyed: false,
    get state() {
      return state;
    },
  } as unknown as EditorView;
  return { dispatched, focus, view };
}

const showToast = vi.fn();
const invalidate = vi.fn();
const setFileContent = vi.fn();

beforeEach(() => {
  vi.mocked(renameBlockId).mockReset();
  vi.mocked(loadedTabId).mockReturnValue("t1");
  useEditorStore.setState({ documentSurfaceAccess: null } as never);
  // ‼️ mockReset, not mockClear — two cases install a THROWING implementation
  // and `mockClear` keeps it, so the later cases would inherit the throw and
  // pass for the wrong reason (they did, against the unfixed source).
  showToast.mockReset();
  invalidate.mockReset();
  setFileContent.mockReset();
  useUIStore.setState({ showToast });
  useLinkStore.setState({ invalidate });
  useFileStore.setState({
    openFiles: new Map([["/vault/other.md", "stale"]]),
    setFileContent,
  } as never);
  activeTab("/vault/note.md");
});

describe("commitBlockIdEdit — the document follows the backend (issue 594)", () => {
  it("leaves the document on the old ID when the backend refuses, and says so", async () => {
    const errors = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.mocked(renameBlockId).mockRejectedValue("LINK_INDEX_NOT_READY");
    const { dispatched, view } = makeView();

    commitBlockIdEdit(view, 0, "fresh");
    // The input closes at once; the block stays focused, still `old`.
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.docChanged).toBe(false);
    expect(dispatched[0]!.getMeta(blockIdDecoKey)).toEqual({
      editingBlockPos: null,
      focusedBlockPos: 0,
    });
    expect(renameBlockId).toHaveBeenCalledWith(
      "/vault/note.md",
      "old",
      "fresh",
    );
    await flush();

    expect(blockIds(view)).toEqual(["old", null, "old"]);
    expect(dispatched).toHaveLength(1);
    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type] = showToast.mock.calls[0]!;
    expect(message).toContain("LINK_INDEX_NOT_READY");
    expect(type).toBe("error");
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("applies the new ID — and the same-document references — once the backend agrees", async () => {
    vi.mocked(renameBlockId).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: ["/vault/other.md"],
    });
    const { dispatched, focus, view } = makeView();

    commitBlockIdEdit(view, 0, "fresh");
    expect(blockIds(view)).toEqual(["old", null, "old"]);
    await flush();

    expect(blockIds(view)).toEqual(["fresh", null, "fresh"]);
    // Closing transaction, then the one that changes the doc.
    expect(dispatched.map((tr) => tr.docChanged)).toEqual([false, true]);
    // Focus moved back to the editor when the input closed, not a second time
    // when the backend answered (the user may have gone elsewhere meanwhile).
    expect(focus).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
    expect(setFileContent).toHaveBeenCalledWith("/vault/other.md", "reloaded");
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("finds the block by its ID, not by where the edit started", async () => {
    let resolve!: (r: {
      skippedFiles: string[];
      updatedFiles: string[];
    }) => void;
    vi.mocked(renameBlockId).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { view } = makeView();

    commitBlockIdEdit(view, 0, "fresh");
    // While the IPC is in flight the user types a paragraph ABOVE the block.
    view.dispatch(
      view.state.tr.insert(
        0,
        schema.node("paragraph", null, [schema.text("typed meanwhile")]),
      ),
    );
    resolve({ skippedFiles: [], updatedFiles: [] });
    await flush();

    expect(blockIds(view)).toEqual([null, "fresh", null, "fresh"]);
  });

  it("lands in the tab's cached document when another tab is showing by the time the backend answers", async () => {
    // The editor is one view for every tab: switching tabs swaps its doc and
    // caches the outgoing one. A block `^old` in the OTHER file must not be
    // renamed; the cached document of OUR tab must.
    let resolve!: (r: {
      skippedFiles: string[];
      updatedFiles: string[];
    }) => void;
    vi.mocked(renameBlockId).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { dispatched, view } = makeView();
    const cache = new Map([["t1", view.state]]);
    useEditorStore.setState({
      documentSurfaceAccess: {
        editor: { isDestroyed: false, view } as never,
        editorStateCache: cache,
        keepaliveEditor: () => null,
      },
      markDirty: vi.fn(),
    } as never);

    commitBlockIdEdit(view, 0, "fresh");
    activeTab("/vault/elsewhere.md");
    vi.mocked(loadedTabId).mockReturnValue("t2");
    resolve({ skippedFiles: [], updatedFiles: [] });
    await flush();

    // The view (now the other file) is untouched; the cache entry moved on.
    expect(blockIds(view)).toEqual(["old", null, "old"]);
    expect(dispatched).toHaveLength(1);
    const cached = cache.get("t1")!;
    const ids: (null | string)[] = [];
    cached.doc.descendants((n) => {
      if (n.type.name === "paragraph" || n.type.name === "blockReference") {
        ids.push(n.attrs.blockId as null | string);
      }
      return true;
    });
    expect(ids).toEqual(["fresh", null, "fresh"]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("waits for the content to be installed, not for the active tab id to flip", async () => {
    // A tab switch changes `activeTabId` first and installs the document a
    // moment later. In between, the active tab is another file while the view
    // still holds ours — the rename must still land here, not be refused.
    let resolve!: (r: {
      skippedFiles: string[];
      updatedFiles: string[];
    }) => void;
    vi.mocked(renameBlockId).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { view } = makeView();

    commitBlockIdEdit(view, 0, "fresh");
    activeTab("/vault/elsewhere.md"); // activeTabId flipped…
    vi.mocked(loadedTabId).mockReturnValue("t1"); // …but our doc is still in
    resolve({ skippedFiles: [], updatedFiles: [] });
    await flush();

    expect(blockIds(view)).toEqual(["fresh", null, "fresh"]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("a keep-alive editor keeps its own document — the rename lands even while its tab is in the background", async () => {
    let resolve!: (r: {
      skippedFiles: string[];
      updatedFiles: string[];
    }) => void;
    vi.mocked(renameBlockId).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { view } = makeView();
    // The pooled editor's DOM sits under the keep-alive marker
    // (MarkdownSurface.tsx); the shared editor's does not.
    const host = document.createElement("div");
    host.setAttribute("data-keepalive-editor", "");
    const dom = document.createElement("div");
    host.appendChild(dom);
    (view as unknown as { dom: HTMLElement }).dom = dom;

    commitBlockIdEdit(view, 0, "fresh");
    activeTab("/vault/elsewhere.md");
    vi.mocked(loadedTabId).mockReturnValue("t2");
    resolve({ skippedFiles: [], updatedFiles: [] });
    await flush();

    expect(blockIds(view)).toEqual(["fresh", null, "fresh"]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("warns when the block no longer carries the old ID by the time the backend answers", async () => {
    const warns = vi.spyOn(logger, "warn").mockImplementation(() => {});
    let resolve!: (r: {
      skippedFiles: string[];
      updatedFiles: string[];
    }) => void;
    vi.mocked(renameBlockId).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { view } = makeView();

    commitBlockIdEdit(view, 0, "fresh");
    view.dispatch(
      view.state.tr.setNodeMarkup(0, undefined, { blockId: "other" }),
    );
    resolve({ skippedFiles: [], updatedFiles: [] });
    await flush();

    expect(blockIds(view)).toEqual(["other", null, "old"]);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0]![1]).toBe("warning");
    warns.mockRestore();
  });

  it("keeps a backend-committed rename out of the undo history — the other files cannot be undone from here", async () => {
    vi.mocked(renameBlockId).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: ["/vault/other.md"],
    });
    const { view } = makeView();
    // A real edit first, so there IS something on the undo stack.
    view.dispatch(view.state.tr.insertText("!", 6));
    expect(view.state.doc.child(0).textContent).toBe("hello!");

    commitBlockIdEdit(view, 0, "fresh");
    await flush();
    expect(blockIds(view)).toEqual(["fresh", null, "fresh"]);

    // Undo takes back the typed "!" — not the rename.
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.child(0).textContent).toBe("hello");
    expect(blockIds(view)).toEqual(["fresh", null, "fresh"]);
    // Nothing older to undo: the rename left no entry of its own.
    expect(undo(view.state, view.dispatch)).toBe(false);
  });

  it("CONTROL: an edit no other file can see stays undoable", () => {
    const { view } = makeView();
    commitBlockIdEdit(view, 0, null);
    expect(blockIds(view)).toEqual([null, null, "old"]);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(blockIds(view)).toEqual(["old", null, "old"]);
  });

  it("applies the rename but warns about referring files the backend could not rewrite", async () => {
    const warns = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.mocked(renameBlockId).mockResolvedValue({
      skippedFiles: ["/vault/ro/a.md", "/vault/ro/b.md"],
      updatedFiles: ["/vault/other.md"],
    });
    const { view } = makeView();

    commitBlockIdEdit(view, 0, "fresh");
    await flush();

    expect(blockIds(view)).toEqual(["fresh", null, "fresh"]);
    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type] = showToast.mock.calls[0]!;
    expect(message).toContain("2");
    expect(type).toBe("warning");
    warns.mockRestore();
  });
});

describe("commitBlockIdEdit — one rename of a block at a time", () => {
  it("refuses a second rename of the same block while the first is in flight", async () => {
    let resolve!: (r: {
      skippedFiles: string[];
      updatedFiles: string[];
    }) => void;
    vi.mocked(renameBlockId).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { view } = makeView();
    commitBlockIdEdit(view, 0, "fresh");
    // The block still shows ^old; the user opens the widget again and commits
    // another ID before the backend has answered.
    commitBlockIdEdit(view, 0, "another");
    expect(renameBlockId).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0]![1]).toBe("warning");

    resolve({ skippedFiles: [], updatedFiles: [] });
    await flush();
    expect(blockIds(view)).toEqual(["fresh", null, "fresh"]);
    // Settled: a new rename goes through.
    vi.mocked(renameBlockId).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: [],
    });
    commitBlockIdEdit(view, 0, "another");
    await flush();
    expect(renameBlockId).toHaveBeenCalledTimes(2);
    expect(blockIds(view)).toEqual(["another", null, "another"]);
  });
});

describe("commitBlockIdEdit — edits no other file can see apply at once", () => {
  it("removes an ID without asking the backend", () => {
    const { dispatched, view } = makeView();
    commitBlockIdEdit(view, 0, null);
    expect(blockIds(view)).toEqual([null, null, "old"]);
    expect(dispatched).toHaveLength(1);
    expect(renameBlockId).not.toHaveBeenCalled();
  });

  it("assigns an ID to a block that had none without asking the backend", () => {
    const { view } = makeView();
    // The second paragraph, right after the first one, has no ID.
    const pos = view.state.doc.child(0).nodeSize;
    commitBlockIdEdit(view, pos, "fresh");
    expect(blockIds(view)).toEqual(["old", "fresh", "old"]);
    expect(renameBlockId).not.toHaveBeenCalled();
  });

  it("re-committing the same ID changes nothing elsewhere", () => {
    const { view } = makeView();
    commitBlockIdEdit(view, 0, "old");
    expect(blockIds(view)).toEqual(["old", null, "old"]);
    expect(renameBlockId).not.toHaveBeenCalled();
  });

  it("renames locally when the tab has no file yet — there is nothing to rename elsewhere", () => {
    activeTab(undefined);
    const { view } = makeView();
    commitBlockIdEdit(view, 0, "fresh");
    expect(blockIds(view)).toEqual(["fresh", null, "fresh"]);
    expect(renameBlockId).not.toHaveBeenCalled();
  });
});

describe("commitBlockIdEdit — the toast belongs to the IPC rejection only (issue 263)", () => {
  it("stays silent and only logs when the local cache refresh throws", async () => {
    // `invalidate` is the last statement of the success body and sits outside
    // the pre-existing inner try, so it is what a local throw looks like from
    // the handler's point of view. The backend has already rewritten the
    // references by then — a failure toast here would be a lie.
    const errors = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.mocked(renameBlockId).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: ["/vault/other.md"],
    });
    invalidate.mockImplementation(() => {
      throw new Error("boom");
    });

    commitBlockIdEdit(makeView().view, 0, "fresh");
    await flush();

    expect(showToast).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      "[blockId] refreshing renamed references failed:",
      expect.any(Error),
    );
    errors.mockRestore();
  });

  it("stays silent when writing the reloaded content throws", async () => {
    // Never reached the outer handler even before issue 263 — `readFile` +
    // `setFileContent` have their own "file may have been deleted" catch — so
    // this pins that swallow rather than the outer one.
    vi.mocked(renameBlockId).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: ["/vault/other.md"],
    });
    setFileContent.mockImplementation(() => {
      throw new Error("boom");
    });

    commitBlockIdEdit(makeView().view, 0, "fresh");
    await flush();

    expect(setFileContent).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("CONTROL: a clean rename refreshes the cache and toasts nothing", async () => {
    vi.mocked(renameBlockId).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: ["/vault/other.md"],
    });

    commitBlockIdEdit(makeView().view, 0, "fresh");
    await flush();

    expect(setFileContent).toHaveBeenCalledWith("/vault/other.md", "reloaded");
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe("the edit widget commits once", () => {
  it("Enter followed by blur is one rename, not two", async () => {
    // Enter commits and hands focus back to the editor. If the input is still
    // in the DOM at that moment it blurs — and blur commits too. With the
    // commit waiting on the backend the block still says `old`, so a second
    // commit would be a second `rename_block_id` for the same pair.
    vi.mocked(renameBlockId).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: [],
    });
    const { view } = makeView();
    const widget = createEditWidget("old", view, 0);
    const input = widget.querySelector("input")!;
    input.value = "fresh";

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    input.dispatchEvent(new FocusEvent("blur"));
    await flush();

    expect(renameBlockId).toHaveBeenCalledTimes(1);
    expect(blockIds(view)).toEqual(["fresh", null, "fresh"]);
  });

  it("Escape then blur cancels once and never renames", () => {
    const { dispatched, view } = makeView();
    const widget = createEditWidget("old", view, 0);
    const input = widget.querySelector("input")!;
    input.value = "fresh";

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    input.dispatchEvent(new FocusEvent("blur"));

    expect(renameBlockId).not.toHaveBeenCalled();
    expect(dispatched).toHaveLength(1);
    expect(blockIds(view)).toEqual(["old", null, "old"]);
  });
});
