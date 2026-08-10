import type { EditorTab } from "../../../stores/editor/editor";

// §260 Phase 4b / §69 — the two active-tab derivations that had no coverage at all.
//
// ‼️ Nothing imports `App` in the test suite, so before this file a mutation to either of
// these was invisible: `editorSurfaceBlockReason` is the gate that stops a sandboxed plugin
// reading a document the active tab does not hold, and `activePluginIdOf` selects the detail
// branch. Both lived inline in `App.tsx`.
import { describe, expect, it } from "vitest";

import { activePluginIdOf, editorSurfaceBlockReason } from "../active-tab";

function tab(over: Partial<EditorTab> = {}): EditorTab {
  return {
    contextId: "ctx",
    filePath: "/vault/a.md",
    id: "t1",
    isDirty: false,
    isPinned: false,
    title: "a.md",
    ...over,
  };
}

const clean = {
  isCodeFile: false,
  isPdfTab: false,
  isSourceMode: false,
};

describe("activePluginIdOf", () => {
  it("returns the id of the active plugin tab", () => {
    const t = tab({ id: "p1", pluginId: "word-count", type: "plugin" });
    expect(activePluginIdOf([t], "p1")).toBe("word-count");
  });

  it("returns null for a file or graph tab, and for no tab at all", () => {
    expect(activePluginIdOf([tab()], "t1")).toBeNull();
    expect(activePluginIdOf([tab({ id: "g", type: "graph" })], "g")).toBeNull();
    expect(activePluginIdOf([], null)).toBeNull();
  });

  it("ignores a plugin tab that is not the active one", () => {
    // The selector keys on `activeTabId`; returning the first plugin tab found would render
    // one plugin's detail while another's tab is focused.
    const p = tab({ id: "p1", pluginId: "a", type: "plugin" });
    expect(activePluginIdOf([p, tab()], "t1")).toBeNull();
  });
});

describe("editorSurfaceBlockReason", () => {
  it("does not block a markdown file tab in WYSIWYG — the editor IS its content", () => {
    // Non-vacuity: every assertion below is a block, and they all pass for a function that
    // blocks unconditionally, which would disable the plugin editor API entirely.
    expect(editorSurfaceBlockReason({ activeTab: tab(), ...clean })).toBeNull();
  });

  it("blocks a plugin tab", () => {
    const t = tab({ filePath: "", pluginId: "a", type: "plugin" });
    expect(editorSurfaceBlockReason({ activeTab: t, ...clean })).toBe(
      "no document is open in the editor",
    );
  });

  it("blocks a graph tab", () => {
    const t = tab({ filePath: "", type: "graph" });
    expect(editorSurfaceBlockReason({ activeTab: t, ...clean })).toBe(
      "no document is open in the editor",
    );
  });

  it("blocks a tab kind that does not exist yet", () => {
    // ‼️ THE POINT OF THE INVERSION. This asks the question the enumerated version could not:
    // a future non-file tab type must be blocked by DEFAULT. With the old
    // `isGraphTabActive || !!activePluginId || isPdfTab` this returned null — a plugin could
    // read the editor.
    const t = {
      ...tab({ filePath: "" }),
      type: "canvas",
    } as unknown as EditorTab;
    expect(editorSurfaceBlockReason({ activeTab: t, ...clean })).toBe(
      "no document is open in the editor",
    );
  });

  it("blocks when no tab is open at all", () => {
    // Behaviour change, in the safe direction: previously this returned null with no tabs, so
    // a plugin could read whatever the shared editor still held.
    expect(editorSurfaceBlockReason({ activeTab: undefined, ...clean })).toBe(
      "no document is open in the editor",
    );
  });

  it("blocks a PDF tab even though it is a file tab", () => {
    expect(
      editorSurfaceBlockReason({
        activeTab: tab({ filePath: "/a.pdf" }),
        ...clean,
        isPdfTab: true,
      }),
    ).toBe("no document is open in the editor");
  });

  it("reports source mode and non-markdown distinctly, and in that order", () => {
    // The messages are the plugin API's error text; collapsing them tells an author the wrong
    // thing about why a read failed. Source mode wins because a source-mode CODE tab is still
    // "not its content" for the same reason.
    expect(
      editorSurfaceBlockReason({
        activeTab: tab(),
        ...clean,
        isSourceMode: true,
      }),
    ).toBe(
      "the document is open in source mode, so the editor is not its content",
    );
    expect(
      editorSurfaceBlockReason({
        activeTab: tab({ filePath: "/a.ts" }),
        ...clean,
        isCodeFile: true,
      }),
    ).toBe("the active tab is not a markdown document");
    expect(
      editorSurfaceBlockReason({
        activeTab: tab({ filePath: "/a.ts" }),
        ...clean,
        isCodeFile: true,
        isSourceMode: true,
      }),
    ).toBe(
      "the document is open in source mode, so the editor is not its content",
    );
  });
});
