// §69 — the plugin detail tab. A THIRD tab type after "file" and "graph", so the
// assertions below are as much about what a non-file tab must NOT acquire (a dirty
// flag, a file path, a save path) as about the payload it carries.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/vault-context-loader", () => ({
  switchContext: (...a: unknown[]) => switchContext(...a),
}));

import { useContextStore } from "../../context/context";
import { isFileTab, isGraphTab, isPluginTab, useEditorStore } from "../editor";

const switchContext = vi.fn();

/**
 * `setActiveTab` reaches `switchContext` through a dynamic `import()`, which settles on the
 * module graph rather than in the microtask queue — a run of `await Promise.resolve()` is not
 * enough, and using one made the non-vacuity control below fail while the guarded assertion
 * "passed".
 */
async function settleDynamicImport(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  switchContext.mockClear();
  useEditorStore.setState({ tabs: [], activeTabId: null, mruOrder: [] });
});

describe("openPluginTab (§69)", () => {
  it("opens a plugin tab carrying the plugin id and no file path", () => {
    useEditorStore.getState().openPluginTab("baram-word-count", "Word Count");

    const { tabs, activeTabId } = useEditorStore.getState();
    expect(tabs).toHaveLength(1);
    const tab = tabs[0]!;
    expect(tab.type).toBe("plugin");
    expect(tab.pluginId).toBe("baram-word-count");
    expect(tab.title).toBe("Word Count");
    // ‼️ An empty filePath is what keeps this tab out of every file code path. A
    // plugin id parked in `filePath` would be read as a path by the save and
    // switching logic.
    expect(tab.filePath).toBe("");
    expect(tab.isDirty).toBe(false);
    expect(activeTabId).toBe(tab.id);
  });

  it("is a singleton PER PLUGIN — reopening activates rather than duplicates", () => {
    const store = useEditorStore.getState();
    store.openPluginTab("a", "A");
    const firstId = useEditorStore.getState().activeTabId;
    store.openPluginTab("b", "B");
    store.openPluginTab("a", "A");

    const { tabs, activeTabId } = useEditorStore.getState();
    // Two plugins, two tabs — a shared singleton (the graph-tab rule) would have
    // collapsed these into one and shown the wrong plugin.
    expect(tabs).toHaveLength(2);
    expect(activeTabId).toBe(firstId);
  });

  it("does not collide with the graph tab", () => {
    const store = useEditorStore.getState();
    store.openGraphTab();
    store.openPluginTab("a", "A");

    const { tabs } = useEditorStore.getState();
    expect(tabs).toHaveLength(2);
    expect(tabs.filter((t) => isGraphTab(t))).toHaveLength(1);
    expect(tabs.filter((t) => isPluginTab(t))).toHaveLength(1);
  });
});

describe("tab-type predicates", () => {
  it("classifies a plugin tab as neither file nor graph", () => {
    useEditorStore.getState().openPluginTab("a", "A");
    const tab = useEditorStore.getState().tabs[0];

    expect(isPluginTab(tab)).toBe(true);
    // The whole read-only story rests on this: every save/dirty/source-mode guard
    // asks `isFileTab`.
    expect(isFileTab(tab)).toBe(false);
    expect(isGraphTab(tab)).toBe(false);
  });

  it("still treats a typeless tab as a file tab (persisted-shape compat)", () => {
    const legacy = {
      contextId: "",
      filePath: "/a.md",
      id: "1",
      isDirty: false,
      isPinned: false,
      title: "a.md",
    };
    expect(isFileTab(legacy)).toBe(true);
    expect(isPluginTab(legacy)).toBe(false);
  });
});

// §89 / §81 — a non-file tab inherits `contextId` from the active context (`openTab`
// backfills it for every tab), and two consumers read that field as "this tab belongs to a
// vault/file". Both were wrong for a tab that shows no vault content.
describe("a plugin tab does not act as a member of its backfilled context", () => {
  beforeEach(() => {
    useContextStore.setState({
      activeContextId: "ctx-file",
      contexts: [
        {
          alias: "a.md",
          contextType: "file",
          id: "ctx-file",
          path: "/outside/a.md",
        },
        { alias: "V", contextType: "vault", id: "ctx-vault", path: "/vault" },
      ] as never,
    });
  });

  it("does not keep a §89 FileContext alive after its file tab closes", () => {
    // The leak: `closeTab` removed the FileContext only when NO tab still carried its id, and
    // the plugin tab carried it. Nothing else removes a FileContext, so it leaked for the rest
    // of the session.
    const removeContext = vi.fn().mockResolvedValue(undefined);
    useContextStore.setState({ removeContext } as never);
    const store = useEditorStore.getState();
    store.openTab({
      contextId: "ctx-file",
      filePath: "/outside/a.md",
      id: "f1",
      isDirty: false,
      isPinned: false,
      title: "a.md",
    });
    store.openPluginTab("word-count", "Word Count");
    // Non-vacuity: the backfill really did happen, so this test is about the count and not
    // about a tab that never had the id.
    expect(
      useEditorStore.getState().tabs.find((t) => t.type === "plugin")
        ?.contextId,
    ).toBe("ctx-file");

    useEditorStore.getState().closeTab("f1");

    expect(removeContext).toHaveBeenCalledWith("ctx-file");
  });

  it("still keeps it alive while another FILE tab holds it", () => {
    // The complement — without this, the assertion above passes for a build that removes the
    // context whenever any tab closes.
    const removeContext = vi.fn().mockResolvedValue(undefined);
    useContextStore.setState({ removeContext } as never);
    const store = useEditorStore.getState();
    for (const id of ["f1", "f2"]) {
      store.openTab({
        contextId: "ctx-file",
        filePath: `/outside/${id}.md`,
        id,
        isDirty: false,
        isPinned: false,
        title: id,
      });
    }

    useEditorStore.getState().closeTab("f1");

    expect(removeContext).not.toHaveBeenCalled();
  });

  it("does not switch the app's context when selected", async () => {
    // Clicking a plugin tab opened in vault A switched the whole app back to A — file tree
    // included — for a screen that shows no vault content.
    //
    // ‼️ Asserts the DECISION, not `activeContextId`. `setActiveTab` reaches `switchContext`
    // through a dynamic import, so the state change lands several ticks later and an earlier
    // version of this test read `activeContextId` before anything had happened — it passed
    // against the unguarded code.
    useContextStore.setState({ activeContextId: "ctx-vault" });
    useEditorStore.getState().openPluginTab("word-count", "Word Count");
    const pluginTabId = useEditorStore.getState().activeTabId!;
    useContextStore.setState({ activeContextId: "ctx-file" });

    useEditorStore.getState().setActiveTab(pluginTabId);
    await settleDynamicImport();

    expect(switchContext).not.toHaveBeenCalled();
  });

  it("DOES switch context for a file tab from another vault", async () => {
    // Non-vacuity: §81's whole point. Without this the assertion above passes for a build
    // that never switches context at all.
    useContextStore.setState({ activeContextId: "ctx-file" });
    useEditorStore.getState().openTab({
      contextId: "ctx-vault",
      filePath: "/vault/a.md",
      id: "f9",
      isDirty: false,
      isPinned: false,
      title: "a.md",
    });

    useEditorStore.getState().setActiveTab("f9");
    await settleDynamicImport();

    expect(switchContext).toHaveBeenCalledWith("ctx-vault");
  });
});
