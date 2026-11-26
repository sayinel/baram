// §313 Where a write for a tab with unsaved edits goes: the place the tab's next save reads
// (`unsavedTabText`), never the disk. Each `null` is a tab whose save would not carry the change from
// there, or where the write does not belong (a closed tab, a source buffer).
import type { DocumentSurfaceAccess } from "../../../stores/editor/editor";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { undo, undoDepth } from "@tiptap/pm/history";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeTestEditor } from "../../../__tests__/helpers/make-test-editor";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import {
  CONTENT_SYNC_META,
  forgetLoadedTab,
  markContentLoaded,
  setTabLoading,
} from "../programmatic-update";
import { serializeEditorState, serializeLiveDoc } from "../serialize-live-doc";
import { unsavedTabText } from "../unsaved-tab-text";

const PATH = "/v/note.md";
const BEFORE = "# NOTE\n\n- [ ] task\n";
const AFTER = "# NOTE\n\n- [x] task\n";

const tab = (isDirty = true) => ({
  contextId: "c",
  filePath: PATH,
  id: "t1",
  isDirty,
  isPinned: false,
  title: "note",
});

let editor: Editor;
let cache: Map<string, EditorState>;

const stateOf = (markdown: string) =>
  EditorState.create({
    doc: markdownToProsemirror(markdown, editor.schema),
    plugins: editor.state.plugins,
  });

const dirty = () => useEditorStore.getState().tabs[0]?.isDirty;

beforeEach(() => {
  editor = makeTestEditor("<p></p>");
  cache = new Map();
  const access: DocumentSurfaceAccess = {
    editor,
    editorStateCache: cache,
    isKeepaliveComplete: () => true,
    keepaliveEditor: () => null,
  };
  useEditorStore.getState().registerDocumentSurfaceAccess(access);
  useEditorStore.setState({
    activeTabId: "other",
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [tab()],
  });
  useFileStore.setState({ openFiles: new Map([[PATH, BEFORE]]) });
});

afterEach(() => {
  setTabLoading("t1", false);
  forgetLoadedTab("t1");
  useEditorStore.getState().registerDocumentSurfaceAccess(null);
  editor.destroy();
});

describe("unsavedTabText", () => {
  it("writes a background tab's text when its text is all there is", () => {
    const at = unsavedTabText("t1", PATH)!;
    expect(at.text).toBe(BEFORE);
    useEditorStore.setState({ tabs: [tab(false)] });

    at.land(AFTER);

    expect(useFileStore.getState().openFiles.get(PATH)).toBe(AFTER);
    expect(dirty()).toBe(true);
  });

  it("leaves a clean tab clean when the text does not change", () => {
    useEditorStore.setState({ tabs: [tab(false)] });

    unsavedTabText("t1", PATH)!.land(BEFORE);

    expect(dirty()).toBe(false);
  });

  // What fails this: dropping the active-tab check on the text. Its install is pending or running and
  // carries the text from before; the document it installs would not have the change.
  it("is nothing for the active tab when only its text is there", () => {
    useEditorStore.setState({ activeTabId: "t1" });
    expect(unsavedTabText("t1", PATH)).toBeNull();
  });

  it("is nothing for a tab still loading", () => {
    setTabLoading("t1", true);
    expect(unsavedTabText("t1", PATH)).toBeNull();
  });

  it("is nothing for a closed tab, a source-mode tab, or a tab with no text", () => {
    useEditorStore.setState({ tabs: [] });
    expect(unsavedTabText("t1", PATH)).toBeNull();

    useEditorStore.setState({ sourceModeTabs: ["t1"], tabs: [tab()] });
    expect(unsavedTabText("t1", PATH)).toBeNull();

    useEditorStore.setState({ sourceModeTabs: [] });
    useFileStore.setState({ openFiles: new Map() });
    expect(unsavedTabText("t1", PATH)).toBeNull();
  });

  // What fails this: reading a tab's text with no surface access. Its document may be in a cache no
  // one can see, and the tab's return would restore that over the text.
  it("is nothing when no surface access is registered", () => {
    useEditorStore.getState().registerDocumentSurfaceAccess(null);
    expect(unsavedTabText("t1", PATH)).toBeNull();
  });

  it("is nothing for a tab that now shows another file", () => {
    useEditorStore.setState({
      tabs: [{ ...tab(), filePath: "/v/renamed.md" }],
    });
    expect(unsavedTabText("t1", PATH)).toBeNull();
  });

  // What fails this: writing the cache when its text says something else — a disk write reached the
  // text while the tab went dirty (`saveSource`'s `cache` case). Landing would rewrite the text from
  // the cache and take that write back out.
  it("is nothing when the cached document and the text differ", () => {
    cache.set("t1", stateOf(BEFORE));
    useFileStore.setState({ openFiles: new Map([[PATH, AFTER]]) });
    expect(unsavedTabText("t1", PATH)).toBeNull();

    useFileStore.setState({ openFiles: new Map([[PATH, BEFORE]]) });
    expect(unsavedTabText("t1", PATH)?.text).toBe(BEFORE);
  });

  // What fails this: landing in the text alone, as the disk route's splice did — the tab comes back
  // to its cached state and its next save writes that.
  it("writes the cached document of a background tab, keeps its edits undoable, and not the change", () => {
    const cached = stateOf(BEFORE);
    const withEdit = cached.apply(cached.tr.insertText("x", 1));
    cache.set("t1", withEdit);
    // The tab switch caches a state with its text (`saveOutgoingTab`).
    useFileStore.setState({
      openFiles: new Map([[PATH, "# xNOTE\n\n- [ ] task\n"]]),
    });
    const depth = undoDepth(withEdit);
    // The edit is in the history — so the depth below says the change did not join it.
    expect(depth).toBeGreaterThan(0);

    const at = unsavedTabText("t1", PATH)!;
    expect(at.text).toBe("# xNOTE\n\n- [ ] task\n");
    at.land("# xNOTE\n\n- [x] task\n");

    const landed = cache.get("t1")!;
    expect(serializeEditorState(landed)).toBe("# xNOTE\n\n- [x] task\n");
    expect(useFileStore.getState().openFiles.get(PATH)).toBe(
      "# xNOTE\n\n- [x] task\n",
    );
    expect(undoDepth(landed)).toBe(depth);
    let undone: EditorState | null = null;
    undo(landed, (tr) => {
      undone = landed.apply(tr);
    });
    expect(serializeEditorState(undone!)).toBe("# NOTE\n\n- [x] task\n");
  });

  // What fails this: reporting a landing that changed nothing. The text differs (an extra blank line)
  // but parses to the same document, so the tab does not hold it, and the caller must not record it.
  it("reports a text the document would not take", () => {
    cache.set("t1", stateOf(BEFORE));
    const at = unsavedTabText("t1", PATH)!;

    expect(at.land("# NOTE\n\n\n- [ ] task\n")).toBe(false);
    expect(serializeEditorState(cache.get("t1")!)).toBe(BEFORE);
    expect(unsavedTabText("t1", PATH)!.land(AFTER)).toBe(true);
  });

  // What fails this: tagging the transaction `CONTENT_SYNC_META`. The auto-save folds such a change
  // into the saved baseline (`use-auto-save.ts`), and this one is not on disk.
  it("dispatches into the editor that holds the tab as an unsaved change", () => {
    editor.view.updateState(stateOf(BEFORE));
    markContentLoaded("t1");
    useEditorStore.setState({ activeTabId: "t1" });
    const seen: Transaction[] = [];
    editor.on("transaction", ({ transaction }) => seen.push(transaction));

    unsavedTabText("t1", PATH)!.land(AFTER);

    expect(serializeLiveDoc(editor)).toBe(AFTER);
    expect(seen).toHaveLength(1);
    expect(seen[0].getMeta(CONTENT_SYNC_META)).toBeUndefined();
    expect(seen[0].getMeta("addToHistory")).toBe(false);
  });
});
