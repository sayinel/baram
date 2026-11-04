// §394 spec 0073 §4 · plan 0125 P13 · P29 — what a renderer is told about its block: the note of
// the editor that HOLDS the block, not the active tab's, through the same translation sandboxed
// file events use (`locateInContext`).
import type { Editor } from "@tiptap/core";

import { afterEach, describe, expect, it } from "vitest";

import { useContextStore } from "../../../stores/context/context";
import { useEditorStore } from "../../../stores/editor/editor";
import {
  markContentLoaded,
  setTabLoading,
} from "../../../utils/editor/programmatic-update";
import { codeBlockInfo } from "../code-block-info";

/** Stand-ins: `codeBlockInfo` tells editors apart by identity only. */
const shared = {} as Editor;
const pooled = {} as Editor;

/**
 * Tabs t1 (active) and t2; the shared editor holds t1 (`loadedTabId`), and `pooled` is t2's
 * keep-alive editor — the shape `useTabSwitching` publishes as `documentSurfaceAccess`.
 */
function holding(t1: string, t2 = "/vaults/a/other.md"): void {
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [
      {
        contextId: "",
        filePath: t1,
        id: "t1",
        isDirty: false,
        isPinned: false,
        title: "1",
      },
      {
        contextId: "",
        filePath: t2,
        id: "t2",
        isDirty: false,
        isPinned: false,
        title: "2",
      },
    ],
  } as never);
  useEditorStore.getState().registerDocumentSurfaceAccess({
    editor: shared,
    editorStateCache: new Map(),
    isKeepaliveComplete: () => true,
    keepaliveEditor: (tabId) => (tabId === "t2" ? pooled : null),
  });
  markContentLoaded("t1");
}

afterEach(() => {
  useEditorStore.getState().registerDocumentSurfaceAccess(null);
  useEditorStore.setState({ activeTabId: null, tabs: [] } as never);
  useContextStore.setState({ contexts: [] } as never);
});

describe("codeBlockInfo", () => {
  /** What fails this: an absolute path for the sandboxed tier (the tier is never told a root), or
   *  a relative one for the trusted tier (spec 0072 D6). */
  it("gives the sandboxed tier a root-relative path and the trusted tier the absolute one", () => {
    useContextStore.setState({
      contexts: [{ contextType: "vault", id: "v1", path: "/vaults/a" }],
    } as never);
    holding("/vaults/a/notes/x.md");
    expect(codeBlockInfo(shared, "chart", "sandboxed")).toEqual({
      context: "v1",
      lang: "chart",
      path: "notes/x.md",
    });
    expect(codeBlockInfo(shared, "chart", "trusted")).toEqual({
      context: "v1",
      lang: "chart",
      path: "/vaults/a/notes/x.md",
    });
  });

  /** §4 — no context: the sandboxed path is null (no root to be relative to), the trusted one stays. */
  it("has no context for a note in none, and nothing for an unsaved note", () => {
    holding("/elsewhere/y.md");
    expect(codeBlockInfo(shared, "chart", "sandboxed")).toEqual({
      context: null,
      lang: "chart",
      path: null,
    });
    expect(codeBlockInfo(shared, "chart", "trusted")).toEqual({
      context: null,
      lang: "chart",
      path: "/elsewhere/y.md",
    });
    holding("");
    expect(codeBlockInfo(shared, "chart", "trusted")).toEqual({
      context: null,
      lang: "chart",
      path: null,
    });
  });

  /** A note opened as a single-file context (§89) IS its context: the sandboxed path is `""`, the
   *  spelling the file and index calls' path gate takes for it (`locateInContext`). What fails
   *  this: folding it to `null`, which would tell the renderer its note has no path. */
  it('gives a note that is its own file context the sandboxed path ""', () => {
    useContextStore.setState({
      contexts: [{ contextType: "file", id: "f1", path: "/elsewhere/one.md" }],
    } as never);
    holding("/elsewhere/one.md");
    expect(codeBlockInfo(shared, "chart", "sandboxed")).toEqual({
      context: "f1",
      lang: "chart",
      path: "",
    });
    expect(codeBlockInfo(shared, "chart", "trusted")).toEqual({
      context: "f1",
      lang: "chart",
      path: "/elsewhere/one.md",
    });
  });

  /** P29 — the note is the HOLDING editor's. What fails this: reading the active tab (t1) — the
   *  background keep-alive editor's block would be told t1's note and cached under it. */
  it("tells a background keep-alive editor its own tab's note", () => {
    holding("/vaults/a/one.md", "/vaults/a/two.md");
    expect(codeBlockInfo(pooled, "chart", "trusted")?.path).toBe(
      "/vaults/a/two.md",
    );
    expect(codeBlockInfo(shared, "chart", "trusted")?.path).toBe(
      "/vaults/a/one.md",
    );
  });

  /** P29 — while a keep-alive tab is the one installed, the shared editor holds a background
   *  document no record names: no info, so the view waits (`null`). What fails this: trusting
   *  `loadedTabId` for the shared editor without the keep-alive check — it would be told t2's note.
   *  The pair: an editor that is no tab's surface (the quick-capture dialog's) holds an unsaved note. */
  it("names nothing for the shared editor behind a keep-alive tab, and an unsaved note elsewhere", () => {
    holding("/vaults/a/one.md", "/vaults/a/two.md");
    markContentLoaded("t2");
    expect(codeBlockInfo(shared, "chart", "trusted")).toBeNull();
    expect(codeBlockInfo({} as Editor, "chart", "trusted")).toEqual({
      context: null,
      lang: "chart",
      path: null,
    });
  });

  /** P29 — a cold load of a document under the keep-alive threshold puts its first chunks into the
   *  shared editor and announces its tab (`markContentLoaded`) only once the last chunk is in
   *  (`load-tab-content.ts`), so `loadedTabId` still names the outgoing tab meanwhile. What fails
   *  this: answering `loadedTabId` while the active tab loads into the shared editor — the incoming
   *  note's block would be told the outgoing note. The pairs: a tab loading into a keep-alive editor
   *  of its own (t2 while it is pooled) leaves the shared editor's answer alone, and so does the
   *  load's end. */
  it("names nothing for the shared editor while the active tab loads into it", () => {
    holding("/vaults/a/one.md", "/vaults/a/two.md");
    useEditorStore.setState({ activeTabId: "t2" } as never);
    setTabLoading("t2", true);
    try {
      expect(codeBlockInfo(shared, "chart", "trusted")?.path).toBe(
        "/vaults/a/one.md",
      );
      useEditorStore.getState().registerDocumentSurfaceAccess({
        editor: shared,
        editorStateCache: new Map(),
        isKeepaliveComplete: () => true,
        keepaliveEditor: () => null,
      });
      expect(codeBlockInfo(shared, "chart", "trusted")).toBeNull();
    } finally {
      setTabLoading("t2", false);
    }
    expect(codeBlockInfo(shared, "chart", "trusted")?.path).toBe(
      "/vaults/a/one.md",
    );
  });
});
