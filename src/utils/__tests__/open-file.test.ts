import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFile } from "../../ipc/fs";
import { notifyFileOpen } from "../../plugins/plugin-lifecycle";
import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { startLastOpenedFileRecorder } from "../../stores/editor/last-opened-file";
import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { requestScroll } from "../editor/pending-scroll";
import { openFileByPath } from "../open-file";

vi.mock("../../ipc/fs", () => ({ readFile: vi.fn() }));
vi.mock("../../plugins/plugin-lifecycle", () => ({ notifyFileOpen: vi.fn() }));
const switchContext = vi.hoisted(() => vi.fn(async (_id: string) => {}));
vi.mock("../../services/vault-context-loader", () => ({
  switchContext: (id: string) => switchContext(id),
}));

const mockReadFile = vi.mocked(readFile);
const realEnsureFileContext = useContextStore.getState().ensureFileContext;

beforeEach(() => {
  useLinkStore.getState().clearPendingScroll();
  useFileStore.setState({ loadError: null });
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useSettingsStore.setState({ recentFiles: [] });
  useContextStore.setState({
    activeContextId: null,
    contexts: [],
    // stub context resolution so we don't touch IPC
    ensureFileContext: vi.fn(async () => ({ id: "ctx1" })),
  } as never);
});

afterEach(() => vi.clearAllMocks());

describe("openFileByPath", () => {
  it("opens a tab and records the file in recents", async () => {
    // §81 The recording is the recorder's: it follows the tab an opener activates
    // (`useAppStartup` starts it once).
    const stop = startLastOpenedFileRecorder();
    try {
      mockReadFile.mockResolvedValue("# hello");
      await openFileByPath("/vault/note.md");

      const { tabs } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toMatchObject({
        filePath: "/vault/note.md",
        title: "note.md",
      });
      expect(useSettingsStore.getState().recentFiles[0].path).toBe(
        "/vault/note.md",
      );
      expect(useSettingsStore.getState().lastOpenedFile).toBe("/vault/note.md");
    } finally {
      stop();
    }
  });

  it("§81 writes no settings itself — the recorder records the file", async () => {
    mockReadFile.mockResolvedValue("# hello");
    const before = useSettingsStore.getState();

    await openFileByPath("/vault/note.md");

    expect(useEditorStore.getState().tabs).toHaveLength(1);
    expect(useSettingsStore.getState()).toBe(before);
  });

  it("does NOT notify plugins of file:open — the tab-switch effect emits it once content loads", async () => {
    mockReadFile.mockResolvedValue("# hello");
    await openFileByPath("/vault/note.md");

    expect(notifyFileOpen).not.toHaveBeenCalled();
  });

  it("throws when reading the file fails (stale path)", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await expect(openFileByPath("/gone/x.md")).rejects.toThrow();
  });

  it("activates an already-open tab instead of opening a duplicate", async () => {
    useEditorStore.getState().openTab({
      contextId: "c",
      id: "t1",
      filePath: "/vault/note.md",
      title: "note.md",
      isDirty: false,
      isPinned: false,
    });
    await openFileByPath("/vault/note.md");
    expect(useEditorStore.getState().tabs).toHaveLength(1);
    expect(useEditorStore.getState().activeTabId).toBe("t1");
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});

// §81 Opening a file switches to the vault or folder it belongs to, by the rule
// `setActiveTab` applies when such a tab is selected later. Before, only a
// FileContext switched: a file of another vault opened as the active tab while the
// vault tab and the file tree stayed on the previous one.
describe("openFileByPath — the file's context", () => {
  const folder = (id: string, path: string) => ({
    addedAt: 0,
    color: "#fff",
    contextType: "folder" as const,
    id,
    label: id,
    path,
  });

  beforeEach(() => {
    mockReadFile.mockResolvedValue("# note");
    switchContext.mockImplementation(async (id: string) => {
      useContextStore.getState()._setActiveContextLocal(id);
    });
    useContextStore.setState({
      activeContextId: "f",
      contexts: [folder("f", "/work"), folder("g", "/other")],
      ensureFileContext: realEnsureFileContext,
    });
  });

  it("switches to another vault or folder context before the tab opens", async () => {
    expect(await openFileByPath("/other/far.md")).toBe("opened");

    expect(switchContext).toHaveBeenCalledWith("g");
    const { activeTabId, tabs } = useEditorStore.getState();
    expect(tabs.find((t) => t.id === activeTabId)).toMatchObject({
      contextId: "g",
      filePath: "/other/far.md",
    });
    expect(useContextStore.getState().activeContextId).toBe("g");
    // The switch came first: the tab never sat in front of another context's tree.
    expect(switchContext.mock.invocationCallOrder[0]).toBeLessThan(
      mockReadFile.mock.invocationCallOrder[0]!,
    );
  });

  it("does not switch for a file of the context already on screen", async () => {
    await openFileByPath("/work/note.md");

    expect(switchContext).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ contextId: "f" });
  });

  it("does not switch to a context at the seat's own path under another id", async () => {
    // The dedup case `setActiveTab` exempts (legacy-xxx vs ctx-xxx).
    useContextStore.setState({
      activeContextId: "f-twin",
      contexts: [folder("f", "/work"), folder("f-twin", "/work")],
    });

    await openFileByPath("/work/note.md");

    expect(switchContext).not.toHaveBeenCalled();
  });

  it("switches before selecting a file already open in another context", async () => {
    // Open in the background, as a tab of another context left behind would be.
    useEditorStore.setState({
      activeTabId: null,
      tabs: [
        {
          contextId: "g",
          filePath: "/other/far.md",
          id: "t-far",
          isDirty: false,
          isPinned: false,
          title: "far.md",
        },
      ],
    });

    await openFileByPath("/other/far.md");

    // Awaited here, not left to `setActiveTab`'s fire-and-forget switch.
    expect(switchContext).toHaveBeenCalledTimes(1);
    expect(switchContext).toHaveBeenCalledWith("g");
    expect(useEditorStore.getState().activeTabId).toBe("t-far");
    expect(useContextStore.getState().activeContextId).toBe("g");
  });

  // §81 A switch the user refuses (§333 approval, or an unresolvable root) returns
  // normally with the seat put back. The open stops there: nothing is read, no tab
  // is shown, and the caller is told — a refusal is not "not found".
  /** What `switchContext` does when `_loadContextFileTree` fails: the seat has
   *  moved, the load error names the context's root, and the error is rethrown. */
  async function failTreeLoad(id: string): Promise<void> {
    useContextStore.getState()._setActiveContextLocal(id);
    const root = useContextStore
      .getState()
      .contexts.find((c) => c.id === id)!.path;
    useFileStore
      .getState()
      .setLoadError({ kind: "generic", message: "listing failed", path: root });
    throw new Error("listing failed");
  }

  it("still opens the file when the switch's tree load fails", async () => {
    // `_loadContextFileTree` reports the failure and rethrows — one unreadable
    // subfolder fails the whole recursive listing. The seat is on the context,
    // as a tab-bar click leaves it, and the file itself is readable.
    switchContext.mockImplementation(failTreeLoad);

    expect(await openFileByPath("/other/far.md")).toBe("opened");

    expect(mockReadFile).toHaveBeenCalledWith("/other/far.md");
    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      contextId: "g",
      filePath: "/other/far.md",
    });
  });

  it("still selects an open tab when the switch's tree load fails", async () => {
    switchContext.mockImplementation(failTreeLoad);
    useEditorStore.setState({
      activeTabId: null,
      tabs: [
        {
          contextId: "g",
          filePath: "/other/far.md",
          id: "t-far",
          isDirty: false,
          isPinned: false,
          title: "far.md",
        },
      ],
    });

    expect(await openFileByPath("/other/far.md")).toBe("opened");
    expect(useEditorStore.getState().activeTabId).toBe("t-far");
  });

  it("lets any other throw out of the switch fail the open", async () => {
    // Accepted only as the tree load's: the seat on the context and its load
    // error set. Anything else is not known to be reported, nor the seat known
    // to have moved — so it is not taken for an open that went through.
    switchContext.mockImplementation(async (id: string) => {
      useContextStore.getState()._setActiveContextLocal(id);
      throw new Error("something else");
    });

    await expect(openFileByPath("/other/far.md")).rejects.toThrow(
      "something else",
    );
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs).toEqual([]);
  });

  it("leaves the scroll target for the tab it opens", async () => {
    // Paired with the refusal below: the landing consumes it.
    useLinkStore.getState().setPendingScrollHeading("Intro");

    await openFileByPath("/other/far.md");

    expect(useLinkStore.getState().pendingScrollHeading).toBe("Intro");
  });

  describe("when the switch is refused", () => {
    beforeEach(() => {
      // The seat stays where it was, as `switchContext` leaves it on a refusal.
      switchContext.mockImplementation(async () => {});
    });

    it("selects nothing and switches once for a file already open in that context", async () => {
      useEditorStore.setState({
        activeTabId: null,
        tabs: [
          {
            contextId: "g",
            filePath: "/other/far.md",
            id: "t-far",
            isDirty: false,
            isPinned: false,
            title: "far.md",
          },
        ],
      });

      // The scroll target a link set for this open goes with it.
      useLinkStore.getState().setPendingScrollHeading("Intro");

      expect(await openFileByPath("/other/far.md")).toBe("refused");
      // `setActiveTab` would start a second switch — a second approval dialog.
      await new Promise((r) => setTimeout(r, 0));

      expect(switchContext).toHaveBeenCalledTimes(1);
      expect(useEditorStore.getState().activeTabId).toBeNull();
      expect(useLinkStore.getState().pendingScrollHeading).toBeNull();
    });

    it("drops the scroll target set for that open", async () => {
      // A wikilink sets its heading before opening, addressed to no file: left
      // in place, the next document to load would scroll to that heading.
      useLinkStore.getState().setPendingScrollHeading("Intro");

      expect(await openFileByPath("/other/far.md")).toBe("refused");

      expect(useLinkStore.getState().pendingScrollHeading).toBeNull();
    });

    it("drops a request addressed to that file, and keeps one addressed to another", async () => {
      requestScroll("/other/far.md", { kind: "line", value: 3 });
      await openFileByPath("/other/far.md");
      expect(useLinkStore.getState().pendingScrollPath).toBeNull();

      requestScroll("/work/elsewhere.md", { kind: "line", value: 3 });
      await openFileByPath("/other/far.md");
      expect(useLinkStore.getState().pendingScrollPath).toBe(
        "/work/elsewhere.md",
      );
    });

    it("reads nothing and opens no tab for a file of that context", async () => {
      expect(await openFileByPath("/other/far.md")).toBe("refused");

      expect(mockReadFile).not.toHaveBeenCalled();
      expect(useEditorStore.getState().tabs).toEqual([]);
    });

    it("opens no tab of a refused context nested in the one on screen", async () => {
      // The parent would permit the read; the tab would still name the refused
      // context in front of the parent's tree.
      useContextStore.setState({
        contexts: [folder("f", "/work"), folder("n", "/work/nested")],
      });

      expect(await openFileByPath("/work/nested/inner.md")).toBe("refused");

      expect(switchContext).toHaveBeenCalledWith("n");
      expect(mockReadFile).not.toHaveBeenCalled();
      expect(useEditorStore.getState().tabs).toEqual([]);
      expect(useContextStore.getState().activeContextId).toBe("f");
    });
  });
});
