// §5.5 Turning the column resize option off takes the widths out of every open
// markdown tab, wherever its document is right now (spec 0075 D4, D6, D7).
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

import { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type MockInstance,
  vi,
} from "vitest";

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  writeFile: vi.fn(async () => undefined),
}));
vi.mock("../programmatic-update", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../programmatic-update")>()),
  isTabLoading: vi.fn(() => false),
  loadedTabId: vi.fn(() => "t1"),
}));
// The real serializer, wrapped so a test can count how often it runs.
vi.mock("../../../pipeline/pm-to-md", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../pipeline/pm-to-md")>();
  return {
    ...actual,
    prosemirrorToMarkdown: vi.fn(actual.prosemirrorToMarkdown),
  };
});

import { writeFile } from "../../../ipc/invoke";
import { stripTableWidthComments } from "../../../pipeline/convert-table-colwidths";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../../pipeline/pm-to-md";
import {
  type DocumentSurfaceAccess,
  useEditorStore,
} from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { logger } from "../../logger";
import {
  isTabLoading,
  loadedTabId,
  markContentLoaded,
  subscribeContentLoaded,
} from "../programmatic-update";
import {
  clearTableWidthsInOpenTabs,
  setTableColumnResizeFromUser,
} from "../table-width-clear";

const cellAttrs = {
  alignment: { default: null },
  colspan: { default: 1 },
  colwidth: { default: null },
  rowspan: { default: 1 },
  userResized: { default: false },
};
const schema = new Schema({
  marks: {
    bold: {},
    code: {},
    italic: {},
    link: {
      attrs: { href: { default: null }, title: { default: null } },
      inclusive: false,
    },
    strike: {},
  },
  nodes: {
    doc: { content: "block+" },
    hardBreak: { group: "inline", inline: true },
    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
    },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    table: { content: "tableRow+", group: "block" },
    tableCell: { attrs: cellAttrs, content: "paragraph+" },
    tableHeader: { attrs: cellAttrs, content: "paragraph+" },
    tableRow: { content: "(tableCell | tableHeader)+" },
    text: { group: "inline" },
  },
});

/** A table with a width comment, in the bytes the serializer writes for the rest. */
const M = "<!-- colwidths:200,300 -->\n\n| A | B |\n| - | - |\n| 1 | 2 |\n";
const S = stripTableWidthComments(M);

interface FakeView {
  dispatched: Transaction[];
  state: EditorState;
  view: EditorView;
}

function fileTab(tabId: string, filePath = pathOf(tabId)) {
  return { filePath, id: tabId, isDirty: false, type: "file" };
}

/** Whether any cell still carries a width or the mark that writes the comment. */
function hasWidths(state: EditorState): boolean {
  let found = false;
  state.doc.descendants((node) => {
    if (node.attrs.userResized || node.attrs.colwidth) found = true;
    return true;
  });
  return found;
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
    updateState: (next: EditorState) => {
      holder.state = next;
    },
  } as unknown as EditorView;
  return holder;
}

function markedState(markdown = M): EditorState {
  return EditorState.create({
    doc: markdownToProsemirror(markdown, schema),
    schema,
  });
}

function pathOf(tabId: string): string {
  return `/vault/${tabId}.md`;
}

function unmarkedState(markdown = S): EditorState {
  return EditorState.create({
    doc: markdownToProsemirror(markdown, schema),
    schema,
  });
}

const markDirty = vi.fn();
const markSourceEdited = vi.fn();
const setFileContent = vi.fn((path: string, content: string) => {
  openFiles.set(path, content);
});
let openFiles: Map<string, string>;
let cache: Map<string, EditorState>;
let pooledEditors: Map<string, Editor>;
let incomplete: Set<string>;
let shared: FakeView;
let access: DocumentSurfaceAccess;

/** Put a view in the keep-alive pool as `tabId`'s editor. */
function pool(tabId: string, pooled: FakeView): FakeView {
  pooledEditors.set(tabId, {
    isDestroyed: false,
    get state() {
      return pooled.state;
    },
    view: pooled.view,
  } as unknown as Editor);
  return pooled;
}

/** The store's own actions, where the harness replaced some on the live state. */
function storeActions() {
  return useEditorStore.getInitialState();
}

/** The shared view now holds `tabId`, whose tab is active. No notification. */
function holdInSharedView(tabId: string, state: EditorState): FakeView {
  shared = makeView(state);
  (access.editor as { view: EditorView }).view = shared.view;
  vi.mocked(loadedTabId).mockReturnValue(tabId);
  useEditorStore.setState({ activeTabId: tabId } as never);
  return shared;
}

/**
 * A cold load between its first chunk and `finishLoad`: the incoming tab is active
 * and flagged loading, the shared view holds its first blocks, and `loadedTabId`
 * names no tab.
 */
function firstChunkInSharedView(tabId: string, state: EditorState): FakeView {
  const view = holdInSharedView(tabId, state);
  vi.mocked(loadedTabId).mockReturnValue(null);
  vi.mocked(isTabLoading).mockImplementation((id) => id === tabId);
  return view;
}

/** A load's last step: the document is in and the install is announced. */
function install(tabId: string, state = markedState()): FakeView {
  const installed = holdInSharedView(tabId, state);
  markContentLoaded(tabId);
  return installed;
}

function sourceBuffers(initial: Record<string, string>) {
  const buffers = new Map(Object.entries(initial));
  const setSourceBuffer = vi.fn((tabId: string, content: string) => {
    buffers.set(tabId, content);
  });
  useEditorStore.setState({
    sourceBufferAccess: {
      getSourceBuffer: (tabId: string) => buffers.get(tabId) ?? "",
      setSourceBuffer,
    },
    sourceModeTabs: Object.keys(initial),
  } as never);
  return { buffers, setSourceBuffer };
}

beforeEach(() => {
  // No tabs, so no waits: a wait a test left behind ends here.
  useEditorStore.setState({ tabs: [] } as never);
  vi.mocked(loadedTabId).mockReturnValue("t1");
  vi.mocked(isTabLoading).mockReturnValue(false);
  vi.mocked(writeFile).mockClear();
  vi.mocked(prosemirrorToMarkdown).mockClear();
  markDirty.mockReset();
  markSourceEdited.mockReset();
  setFileContent.mockClear();
  openFiles = new Map();
  cache = new Map();
  pooledEditors = new Map();
  incomplete = new Set();
  shared = makeView(unmarkedState());
  access = {
    editor: { isDestroyed: false, view: shared.view } as never,
    editorStateCache: cache,
    isKeepaliveComplete: (tabId) => !incomplete.has(tabId),
    keepaliveEditor: (tabId) => pooledEditors.get(tabId) ?? null,
  };
  useEditorStore.setState({
    activeTabId: "t1",
    documentSurfaceAccess: access,
    markDirty,
    markSourceEdited,
    sourceBufferAccess: null,
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [fileTab("t1"), fileTab("t2")],
  } as never);
  useFileStore.setState({ openFiles, setFileContent } as never);
  useSettingsStore.setState({ tableColumnResize: true });
});

describe("each place a tab's document can be", () => {
  it.each<[string, () => FakeView]>([
    ["the shared view", () => holdInSharedView("t1", markedState())],
    ["its keep-alive editor", () => pool("t1", makeView(markedState(), true))],
  ])(
    "active tab in %s: dispatches into the view and leaves saving to the auto-save",
    (_name, arrange) => {
      const active = arrange();

      clearTableWidthsInOpenTabs();

      expect(active.dispatched).toHaveLength(1);
      expect(active.dispatched[0]!.getMeta("addToHistory")).toBe(false);
      expect(hasWidths(active.state)).toBe(false);
      expect(setFileContent).not.toHaveBeenCalled();
      expect(markDirty).not.toHaveBeenCalled();
    },
  );

  it("hidden keep-alive: dispatches and publishes text and the dirty mark", () => {
    const hidden = pool("t2", makeView(markedState(), true));

    clearTableWidthsInOpenTabs();

    expect(hidden.dispatched).toHaveLength(1);
    expect(hasWidths(hidden.state)).toBe(false);
    expect(openFiles.get(pathOf("t2"))).toBe(S);
    expect(markDirty).toHaveBeenCalledWith("t2", true);
  });

  it("cached background tab: replaces the cache, publishes text and the dirty mark", () => {
    const before = markedState();
    cache.set("t2", before);

    clearTableWidthsInOpenTabs();

    expect(cache.get("t2")).not.toBe(before);
    expect(hasWidths(cache.get("t2")!)).toBe(false);
    expect(openFiles.get(pathOf("t2"))).toBe(S);
    expect(markDirty).toHaveBeenCalledWith("t2", true);
    expect(prosemirrorToMarkdown).toHaveBeenCalledTimes(1);
  });

  it("source-mode tab: rewrites the buffer and marks it edited", () => {
    // The tab's ProseMirror document is still in the shared view, and stale.
    const stale = holdInSharedView("t2", markedState());
    const { buffers } = sourceBuffers({ t2: M });

    clearTableWidthsInOpenTabs();

    expect(buffers.get("t2")).toBe(S);
    expect(markSourceEdited).toHaveBeenCalledWith("t2", true);
    expect(stale.dispatched).toHaveLength(0);
    expect(hasWidths(stale.state)).toBe(true);
    expect(setFileContent).not.toHaveBeenCalled();
  });

  it("source-mode tab with no buffer access: touches nothing, says so, and does not wait", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const stale = holdInSharedView("t2", markedState());
    useEditorStore.setState({
      sourceBufferAccess: null,
      sourceModeTabs: ["t2"],
    } as never);
    useSettingsStore.setState({ tableColumnResize: false });

    clearTableWidthsInOpenTabs();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(markSourceEdited).not.toHaveBeenCalled();
    expect(stale.dispatched).toHaveLength(0);

    useEditorStore.setState({ sourceModeTabs: [] } as never);
    const later = install("t2");
    expect(later.dispatched).toHaveLength(0);
    expect(hasWidths(later.state)).toBe(true);
    warn.mockRestore();
  });

  it.each<[string, () => void]>([
    [
      "stale",
      () => useEditorStore.setState({ staleContentTabs: ["t2"] } as never),
    ],
    [
      "loading",
      () => vi.mocked(isTabLoading).mockImplementation((id) => id === "t2"),
    ],
    [
      "incomplete keep-alive",
      () => {
        pool("t2", makeView(markedState(), true));
        incomplete.add("t2");
      },
    ],
  ])("%s: rewrites the text and marks dirty, cache untouched", (_, arrange) => {
    const cached = markedState();
    cache.set("t2", cached);
    openFiles.set(pathOf("t2"), M);
    arrange();

    clearTableWidthsInOpenTabs();

    expect(openFiles.get(pathOf("t2"))).toBe(S);
    expect(markDirty).toHaveBeenCalledWith("t2", true);
    expect(cache.get("t2")).toBe(cached);
    expect(hasWidths(cached)).toBe(true);
  });

  it("a load in progress: its partial document is left alone, then cleared once the load ends", () => {
    const loading = firstChunkInSharedView("t2", markedState());
    openFiles.set(pathOf("t2"), M);
    useSettingsStore.setState({ tableColumnResize: false });

    clearTableWidthsInOpenTabs();

    expect(loading.dispatched).toHaveLength(0);
    expect(hasWidths(loading.state)).toBe(true);
    expect(openFiles.get(pathOf("t2"))).toBe(S);

    // `finishLoad`: the flag comes off, then the install says which tab is in.
    vi.mocked(isTabLoading).mockReturnValue(false);
    vi.mocked(loadedTabId).mockReturnValue("t2");
    markContentLoaded("t2");

    expect(loading.dispatched).toHaveLength(1);
    expect(hasWidths(loading.state)).toBe(false);
  });

  describe("the tab before a cold load in progress", () => {
    const OTHER =
      "<!-- colwidths:7,8 -->\n\n| Other | B |\n| - | - |\n| 1 | 2 |\n";
    const OTHER_STRIPPED = stripTableWidthComments(OTHER);

    it("clean: is not given the incoming tab's document", () => {
      const own = unmarkedState();
      cache.set("t1", own);
      openFiles.set(pathOf("t1"), S);
      openFiles.set(pathOf("t2"), OTHER);
      const chunk = firstChunkInSharedView("t2", markedState(OTHER));

      clearTableWidthsInOpenTabs();

      expect(cache.get("t1")).toBe(own);
      expect(openFiles.get(pathOf("t1"))).toBe(S);
      expect(markDirty).not.toHaveBeenCalledWith("t1", true);
      expect(chunk.dispatched).toHaveLength(0);
      expect(hasWidths(chunk.state)).toBe(true);
      expect(openFiles.get(pathOf("t2"))).toBe(OTHER_STRIPPED);
    });

    it("with its own widths: has them cleared from its own document", () => {
      cache.set("t1", markedState());
      openFiles.set(pathOf("t1"), M);
      openFiles.set(pathOf("t2"), OTHER);
      const chunk = firstChunkInSharedView("t2", markedState(OTHER));

      clearTableWidthsInOpenTabs();

      const after = cache.get("t1")!;
      expect(after.doc.textContent).not.toContain("Other");
      expect(hasWidths(after)).toBe(false);
      expect(openFiles.get(pathOf("t1"))).toBe(S);
      expect(markDirty).toHaveBeenCalledWith("t1", true);
      expect(chunk.dispatched).toHaveLength(0);
      expect(hasWidths(chunk.state)).toBe(true);
      expect(openFiles.get(pathOf("t2"))).toBe(OTHER_STRIPPED);
    });

    it("after the load is cancelled by a switch to a tab that installs nothing: is still safe", () => {
      const own = markedState();
      cache.set("t1", own);
      openFiles.set(pathOf("t1"), M);
      openFiles.set(pathOf("t2"), OTHER);
      const chunk = firstChunkInSharedView("t2", markedState(OTHER));
      // `cancelInflightAppend` took the flag off, and a graph tab installs nothing.
      vi.mocked(isTabLoading).mockReturnValue(false);
      useEditorStore.setState({
        activeTabId: "t3",
        tabs: [
          fileTab("t1"),
          fileTab("t2"),
          { filePath: "", id: "t3", isDirty: false, type: "graph" },
        ],
      } as never);

      clearTableWidthsInOpenTabs();

      const after = cache.get("t1")!;
      expect(after).not.toBe(own);
      expect(after.doc.textContent).not.toContain("Other");
      expect(hasWidths(after)).toBe(false);
      expect(openFiles.get(pathOf("t1"))).toBe(S);
      expect(chunk.dispatched).toHaveLength(0);
      expect(hasWidths(chunk.state)).toBe(true);
      expect(openFiles.get(pathOf("t2"))).toBe(OTHER_STRIPPED);
    });

    it.each<[string, () => void]>([
      [
        "between the load's flag and its first chunk",
        () => vi.mocked(isTabLoading).mockImplementation((id) => id === "t2"),
      ],
      ["in the cached restore's window, with no load flag", () => {}],
    ])("%s: is cleared in its cache, not in the view", (_name, arrange) => {
      const outgoing = holdInSharedView("t2", markedState());
      vi.mocked(loadedTabId).mockReturnValue(null);
      arrange();
      const own = outgoing.state;
      cache.set("t1", own);
      const updateState = vi.spyOn(outgoing.view, "updateState");

      clearTableWidthsInOpenTabs();

      expect(outgoing.dispatched).toHaveLength(0);
      expect(updateState).not.toHaveBeenCalled();
      expect(hasWidths(outgoing.state)).toBe(true);
      expect(cache.get("t1")).not.toBe(own);
      expect(hasWidths(cache.get("t1")!)).toBe(false);
      expect(openFiles.get(pathOf("t1"))).toBe(S);
      expect(markDirty).toHaveBeenCalledWith("t1", true);
    });

    // §39 Before the switch effect runs the name still stands, and the view does hold the tab. What
    // fails this: limiting the clear to the active tab's view, since `saveOutgoingTab` then caches
    // the view's widths over the cleared cache.
    it("in the gap before the switch effect: is cleared in the view, without an event", () => {
      const outgoing = holdInSharedView("t2", markedState());
      vi.mocked(loadedTabId).mockReturnValue("t1");
      cache.set("t1", outgoing.state);

      clearTableWidthsInOpenTabs();

      expect(outgoing.dispatched).toHaveLength(0);
      expect(hasWidths(outgoing.state)).toBe(false);
      expect(cache.get("t1")).toBe(outgoing.state);
      expect(openFiles.get(pathOf("t1"))).toBe(S);
      expect(markDirty).toHaveBeenCalledWith("t1", true);
    });
  });

  describe("a tab that has been left, with another document in the shared view", () => {
    const OTHER =
      "<!-- colwidths:7,8 -->\n\n| Other | B |\n| - | - |\n| 1 | 2 |\n";

    function otherDocumentInSharedView(state: EditorState) {
      const other = holdInSharedView("t2", state);
      vi.mocked(loadedTabId).mockReturnValue(null);
      return {
        before: other.state,
        other,
        updateState: vi.spyOn(other.view, "updateState"),
      };
    }

    it.each<[string, () => EditorState]>([
      ["with a marked table", () => markedState(OTHER)],
      [
        "with no marked table",
        () => unmarkedState(stripTableWidthComments(OTHER)),
      ],
    ])(
      "that document %s: the tab is cleared in its own cache",
      (_name, state) => {
        cache.set("t1", markedState());
        openFiles.set(pathOf("t1"), M);
        const { before, other, updateState } =
          otherDocumentInSharedView(state());

        clearTableWidthsInOpenTabs();

        expect(other.dispatched).toHaveLength(0);
        expect(updateState).not.toHaveBeenCalled();
        expect(other.state).toBe(before);
        const after = cache.get("t1")!;
        expect(after.doc.textContent).toContain("A");
        expect(after.doc.textContent).not.toContain("Other");
        expect(hasWidths(after)).toBe(false);
        expect(openFiles.get(pathOf("t1"))).toBe(S);
        expect(markDirty).toHaveBeenCalledWith("t1", true);
      },
    );

    it("no cache for the tab: its text is stripped, and it waits for a document", () => {
      openFiles.set(pathOf("t1"), M);
      const { before, other, updateState } = otherDocumentInSharedView(
        markedState(OTHER),
      );

      setTableColumnResizeFromUser(false);

      expect(other.dispatched).toHaveLength(0);
      expect(updateState).not.toHaveBeenCalled();
      expect(other.state).toBe(before);
      expect(openFiles.get(pathOf("t1"))).toBe(S);
      expect(markDirty).toHaveBeenCalledWith("t1", true);

      const installed = install("t1");
      expect(installed.dispatched).toHaveLength(1);
      expect(hasWidths(installed.state)).toBe(false);
    });
  });

  it("an incomplete keep-alive entry: left alone, then cleared once the load marks it complete", () => {
    const filling = pool("t2", makeView(markedState(), true));
    incomplete.add("t2");
    openFiles.set(pathOf("t2"), M);
    useSettingsStore.setState({ tableColumnResize: false });

    clearTableWidthsInOpenTabs();
    expect(filling.dispatched).toHaveLength(0);

    incomplete.delete("t2");
    markContentLoaded("t2");
    expect(filling.dispatched).toHaveLength(1);
    expect(hasWidths(filling.state)).toBe(false);
  });

  it("text only: rewrites the text, and clears the document once it is installed", () => {
    openFiles.set(pathOf("t2"), M);
    useSettingsStore.setState({ tableColumnResize: false });

    clearTableWidthsInOpenTabs();

    expect(openFiles.get(pathOf("t2"))).toBe(S);
    expect(markDirty).toHaveBeenCalledWith("t2", true);

    // Parsed from the old text: its load began before the text changed.
    const installed = install("t2");
    expect(installed.dispatched).toHaveLength(1);
    expect(hasWidths(installed.state)).toBe(false);
  });

  it("nothing yet: writes nothing, and clears once installed", () => {
    useSettingsStore.setState({ tableColumnResize: false });

    clearTableWidthsInOpenTabs();

    expect(setFileContent).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();

    const installed = install("t2");
    expect(installed.dispatched).toHaveLength(1);
    expect(hasWidths(installed.state)).toBe(false);
  });
});

describe("what it leaves alone", () => {
  it("a tab with no marked table: no dispatch, no serialize, no dirty mark", () => {
    const active = holdInSharedView("t1", unmarkedState());
    const hidden = pool("t2", makeView(unmarkedState(), true));
    cache.set("t3", unmarkedState());
    const { setSourceBuffer } = sourceBuffers({ t4: S });
    openFiles.set(pathOf("t5"), S);
    useEditorStore.setState({
      tabs: ["t1", "t2", "t3", "t4", "t5"].map((id) => fileTab(id)),
    } as never);

    clearTableWidthsInOpenTabs();

    expect(active.dispatched).toHaveLength(0);
    expect(hidden.dispatched).toHaveLength(0);
    expect(prosemirrorToMarkdown).not.toHaveBeenCalled();
    expect(setFileContent).not.toHaveBeenCalled();
    expect(setSourceBuffer).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
    expect(markSourceEdited).not.toHaveBeenCalled();
  });

  it("skips a non-markdown file and a non-file tab", () => {
    const pathOfText = "/vault/data.txt";
    openFiles.set(pathOfText, M);
    openFiles.set("g1", M);
    openFiles.set("p1", M);
    openFiles.set(pathOf("t2"), M);
    useEditorStore.setState({
      tabs: [
        fileTab("x1", pathOfText),
        { filePath: "", id: "g1", isDirty: false, type: "graph" },
        { filePath: "", id: "p1", isDirty: false, type: "plugin" },
        fileTab("t2"),
      ],
    } as never);

    clearTableWidthsInOpenTabs();

    expect(openFiles.get(pathOfText)).toBe(M);
    expect(openFiles.get("g1")).toBe(M);
    expect(openFiles.get("p1")).toBe(M);
    // In the same run, the markdown tab beside them is cleared.
    expect(openFiles.get(pathOf("t2"))).toBe(S);
    expect(markDirty.mock.calls).toEqual([["t2", true]]);
  });

  it("untitled tab: its text key is the tab id", () => {
    openFiles.set("t3", M);
    cache.set("t4", markedState());
    useEditorStore.setState({
      tabs: [fileTab("t3", ""), fileTab("t4", "")],
    } as never);

    clearTableWidthsInOpenTabs();

    expect(openFiles.get("t3")).toBe(S);
    expect(markDirty).toHaveBeenCalledWith("t3", true);
    expect(openFiles.get("t4")).toBe(S);
    expect(markDirty).toHaveBeenCalledWith("t4", true);
  });

  it("never writes to disk", () => {
    const active = holdInSharedView("t1", markedState());
    const hidden = pool("t2", makeView(markedState(), true));
    cache.set("t3", markedState());
    const { buffers } = sourceBuffers({ t4: M });
    openFiles.set(pathOf("t5"), M);
    useEditorStore.setState({
      tabs: ["t1", "t2", "t3", "t4", "t5"].map((id) => fileTab(id)),
    } as never);

    clearTableWidthsInOpenTabs();

    expect(hasWidths(active.state)).toBe(false);
    expect(hasWidths(hidden.state)).toBe(false);
    expect(hasWidths(cache.get("t3")!)).toBe(false);
    expect(buffers.get("t4")).toBe(S);
    expect(openFiles.get(pathOf("t5"))).toBe(S);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("a file opened later, with the option already off, keeps its widths", () => {
    // Every tab open now is settled, so nothing is waiting for a document.
    useEditorStore.setState({ tabs: [fileTab("t1")] } as never);
    setTableColumnResizeFromUser(false);
    openFiles.set(pathOf("t9"), M);
    useEditorStore.setState({
      tabs: [fileTab("t1"), fileTab("t9")],
    } as never);

    const opened = install("t9");

    expect(opened.dispatched).toHaveLength(0);
    expect(hasWidths(opened.state)).toBe(true);
    expect(openFiles.get(pathOf("t9"))).toBe(M);
    expect(markDirty).not.toHaveBeenCalled();

    // The way to clear such a file: with it open, turn the option on and off.
    setTableColumnResizeFromUser(true);
    setTableColumnResizeFromUser(false);
    expect(hasWidths(opened.state)).toBe(false);
  });

  it("a destroyed pooled editor: its stub view is not read, and the run goes on", () => {
    // A destroyed Tiptap editor's `view` answers `isDestroyed: false` and throws on `dom`.
    pooledEditors.set("t2", {
      isDestroyed: true,
      get view() {
        return {
          get dom() {
            throw new Error("[tiptap error]: The editor view is not available");
          },
          isDestroyed: false,
        };
      },
    } as unknown as Editor);
    cache.set("t2", markedState());
    cache.set("t3", markedState());
    useEditorStore.setState({
      tabs: [fileTab("t2"), fileTab("t3")],
    } as never);

    expect(() => {
      clearTableWidthsInOpenTabs();
    }).not.toThrow();

    expect(hasWidths(cache.get("t2")!)).toBe(false);
    expect(hasWidths(cache.get("t3")!)).toBe(false);
  });
});

describe("waiting for a document", () => {
  it("turned back on before the load ends: does not clear", () => {
    setTableColumnResizeFromUser(false);
    setTableColumnResizeFromUser(true);

    const installed = install("t2");

    expect(installed.dispatched).toHaveLength(0);
    expect(hasWidths(installed.state)).toBe(true);
  });

  it("a closed tab reopened under the same id: does not clear", () => {
    openFiles.set(pathOf("t2"), M);
    setTableColumnResizeFromUser(false);

    useEditorStore.setState({ tabs: [fileTab("t1")] } as never);
    useEditorStore.setState({
      tabs: [fileTab("t1"), fileTab("t2")],
    } as never);
    const reopened = install("t2");

    expect(reopened.dispatched).toHaveLength(0);
    expect(hasWidths(reopened.state)).toBe(true);
  });

  it("a tab that stays open is still cleared once installed", () => {
    openFiles.set(pathOf("t2"), M);
    setTableColumnResizeFromUser(false);

    const installed = install("t2");

    expect(installed.dispatched).toHaveLength(1);
    expect(hasWidths(installed.state)).toBe(false);
  });

  it.each<[string, () => void]>([
    ["closeTab", () => storeActions().closeTab("t2")],
    ["closeOtherTabs", () => storeActions().closeOtherTabs("t1")],
    ["closeTabsToRight", () => storeActions().closeTabsToRight("t1")],
    [
      "closeTabsForContexts",
      () => storeActions().closeTabsForContexts(new Set(["c2"])),
    ],
    ["closeAllTabs", () => storeActions().closeAllTabs()],
  ])("a wait ends with its tab when %s closes it", (_name, close) => {
    const t2 = { ...fileTab("t2"), contextId: "c2" };
    useEditorStore.setState({ tabs: [fileTab("t1"), t2] } as never);
    openFiles.set(pathOf("t2"), M);
    setTableColumnResizeFromUser(false);

    close();
    expect(useEditorStore.getState().tabs).not.toContainEqual(t2);
    useEditorStore.setState({ tabs: [fileTab("t1"), t2] } as never);
    const reopened = install("t2");

    expect(reopened.dispatched).toHaveLength(0);
    expect(hasWidths(reopened.state)).toBe(true);
  });

  it.each<[string, () => void]>([
    ["a dirty mark on another tab", () => storeActions().markDirty("t1", true)],
    ["another tab closing", () => storeActions().closeTab("t1")],
  ])("a tab that stays open keeps its wait across %s", (_name, change) => {
    openFiles.set(pathOf("t2"), M);
    setTableColumnResizeFromUser(false);
    const before = useEditorStore.getState().tabs;

    change();

    expect(useEditorStore.getState().tabs).not.toBe(before);
    const installed = install("t2");
    expect(installed.dispatched).toHaveLength(1);
    expect(hasWidths(installed.state)).toBe(false);
  });

  it("a wait added after an earlier one ended is dropped on close too", () => {
    openFiles.set(pathOf("t2"), M);
    setTableColumnResizeFromUser(false);
    useEditorStore.setState({ tabs: [fileTab("t1")] } as never);
    useEditorStore.setState({
      tabs: [fileTab("t1"), fileTab("t2")],
    } as never);

    setTableColumnResizeFromUser(true);
    setTableColumnResizeFromUser(false);
    useEditorStore.setState({ tabs: [fileTab("t1")] } as never);
    useEditorStore.setState({
      tabs: [fileTab("t1"), fileTab("t2")],
    } as never);
    const reopened = install("t2");

    expect(reopened.dispatched).toHaveLength(0);
    expect(hasWidths(reopened.state)).toBe(true);
  });

  describe("the watch on the tab list", () => {
    let stops: Mock<() => void>[];
    let subscribe: MockInstance<typeof useEditorStore.subscribe>;

    beforeEach(() => {
      const original = useEditorStore.subscribe;
      stops = [];
      subscribe = vi
        .spyOn(useEditorStore, "subscribe")
        .mockImplementation((listener) => {
          const stop = vi.fn(original(listener));
          stops.push(stop);
          return stop;
        });
    });

    afterEach(() => {
      subscribe.mockRestore();
    });

    it.each<[string, () => void]>([
      [
        "its tab closes",
        () => useEditorStore.setState({ tabs: [fileTab("t1")] } as never),
      ],
      ["its document is installed", () => install("t2")],
    ])("is removed when the last wait ends because %s", (_name, end) => {
      openFiles.set(pathOf("t2"), M);
      setTableColumnResizeFromUser(false);
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(stops[0]).not.toHaveBeenCalled();

      end();

      expect(stops[0]).toHaveBeenCalledTimes(1);
    });

    it("is one subscription for every wait, held until the last one ends", () => {
      useEditorStore.setState({
        tabs: [fileTab("t1"), fileTab("t2"), fileTab("t3")],
      } as never);
      openFiles.set(pathOf("t2"), M);
      openFiles.set(pathOf("t3"), M);

      setTableColumnResizeFromUser(false);
      expect(subscribe).toHaveBeenCalledTimes(1);

      useEditorStore.setState({
        tabs: [fileTab("t1"), fileTab("t3")],
      } as never);
      expect(stops[0]).not.toHaveBeenCalled();

      useEditorStore.setState({ tabs: [fileTab("t1")] } as never);
      expect(stops[0]).toHaveBeenCalledTimes(1);
    });

    it("is not taken when nothing waits", () => {
      useEditorStore.setState({ tabs: [fileTab("t1")] } as never);

      setTableColumnResizeFromUser(false);

      expect(subscribe).not.toHaveBeenCalled();
    });
  });

  it("waits once: a re-check that lands on the text does not wait again", () => {
    useEditorStore.setState({ staleContentTabs: ["t2"] } as never);
    openFiles.set(pathOf("t2"), M);
    setTableColumnResizeFromUser(false);

    // Still flagged stale when announced, so the re-check goes to the text again.
    const first = install("t2");
    expect(first.dispatched).toHaveLength(0);

    useEditorStore.setState({ staleContentTabs: [] } as never);
    const second = install("t2");
    expect(second.dispatched).toHaveLength(0);
    expect(hasWidths(second.state)).toBe(true);
  });
});

describe("one tab's failure", () => {
  it("a tab that fails to serialize is logged, and the next tab is still cleared", () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.mocked(prosemirrorToMarkdown).mockImplementationOnce(() => {
      throw new Error("serialize failed");
    });
    cache.set("t2", markedState());
    cache.set("t3", markedState());
    useEditorStore.setState({
      tabs: [fileTab("t2"), fileTab("t3")],
    } as never);

    clearTableWidthsInOpenTabs();

    expect(error).toHaveBeenCalledTimes(1);
    // Its cache is already cleared while its text kept the comment.
    expect(hasWidths(cache.get("t2")!)).toBe(false);
    expect(markDirty).toHaveBeenCalledWith("t2", true);
    expect(hasWidths(cache.get("t3")!)).toBe(false);
    expect(openFiles.get(pathOf("t3"))).toBe(S);
    expect(markDirty).toHaveBeenCalledWith("t3", true);
    error.mockRestore();
  });

  it("a failing re-check is logged, and the other load listeners still run", () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    const later = vi.fn();
    const stopListening = subscribeContentLoaded(later);
    openFiles.set(pathOf("t2"), M);
    setTableColumnResizeFromUser(false);
    const installed = holdInSharedView("t2", markedState());
    installed.view.dispatch = () => {
      throw new Error("dispatch failed");
    };
    // The run marked t2 for its text. Only the failure can mark it from here.
    markDirty.mockClear();

    markContentLoaded("t2");

    expect(error).toHaveBeenCalledTimes(1);
    expect(markDirty).toHaveBeenCalledWith("t2", true);
    expect(later).toHaveBeenCalledWith("t2");
    stopListening();
    error.mockRestore();
  });
});

describe("the way in", () => {
  it("the user turning it off clears", () => {
    const active = holdInSharedView("t1", markedState());

    setTableColumnResizeFromUser(false);

    expect(useSettingsStore.getState().tableColumnResize).toBe(false);
    expect(hasWidths(active.state)).toBe(false);
  });

  it("a store write without the user, as hydration does, clears nothing", () => {
    const active = holdInSharedView("t1", markedState());

    useSettingsStore.setState({ tableColumnResize: false });

    expect(active.dispatched).toHaveLength(0);
    expect(hasWidths(active.state)).toBe(true);
  });

  it.each([
    ["already off", false, false],
    ["turning on", false, true],
    ["already on", true, true],
  ])("%s only sets the value", (_name, before, after) => {
    const active = holdInSharedView("t1", markedState());
    useSettingsStore.setState({ tableColumnResize: before });

    setTableColumnResizeFromUser(after);

    expect(useSettingsStore.getState().tableColumnResize).toBe(after);
    expect(active.dispatched).toHaveLength(0);
    expect(hasWidths(active.state)).toBe(true);
  });
});
