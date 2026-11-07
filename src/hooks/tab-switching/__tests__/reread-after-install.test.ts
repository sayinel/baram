// §39 A reload that came during an install is read when that install ends, and only for the tab
// that is still active. A tab left in the meantime keeps its flag: its return parses the new text.
import type { Editor } from "@tiptap/core";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeTestEditor } from "../../../__tests__/helpers/make-test-editor";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import {
  forgetLoadedTab,
  loadedTabId,
  markContentLoaded,
} from "../../../utils/editor/programmatic-update";
import { rereadMissedReload } from "../reread-after-install";

const PATH = "/v/note.md";

let editor: Editor;

const fileTab = (id: string) => ({
  contextId: "c",
  filePath: id === "t1" ? PATH : "/v/other.md",
  id,
  isDirty: false,
  isPinned: false,
  title: id,
});

beforeEach(() => {
  editor = makeTestEditor("<p>old text</p>");
  useFileStore.setState({ openFiles: new Map([[PATH, "new text\n"]]) });
  useEditorStore.setState({
    activeTabId: "t1",
    staleContentTabs: ["t1"],
    tabs: [fileTab("t1"), fileTab("t2")],
  });
  useEditorStore.getState().registerDocumentSurfaceAccess({
    editor,
    editorStateCache: new Map(),
    isKeepaliveComplete: () => true,
    keepaliveEditor: () => null,
  });
  markContentLoaded("t1");
});

afterEach(() => {
  useEditorStore.getState().registerDocumentSurfaceAccess(null);
  useEditorStore.setState({
    activeTabId: null,
    staleContentTabs: [],
    tabs: [],
  });
  const named = loadedTabId();
  if (named !== null) forgetLoadedTab(named);
  editor.destroy();
});

describe("rereadMissedReload", () => {
  it("the active flagged tab takes the text and loses the flag", () => {
    rereadMissedReload("t1");

    expect(editor.state.doc.textContent).toBe("new text");
    expect(useEditorStore.getState().staleContentTabs).toEqual([]);
  });

  // What fails this: not asking which tab is active. The document in the view is on its way out, and
  // the flag it would take away is what makes the tab's return parse the new text.
  it("a tab no longer active keeps its flag, and the document is left alone", () => {
    useEditorStore.setState({ activeTabId: "t2" });

    rereadMissedReload("t1");

    expect(editor.state.doc.textContent).toBe("old text");
    expect(useEditorStore.getState().staleContentTabs).toEqual(["t1"]);
  });

  it("a tab with no flag is left alone", () => {
    useEditorStore.setState({ staleContentTabs: [] });

    rereadMissedReload("t1");

    expect(editor.state.doc.textContent).toBe("old text");
  });

  // The flag says the text is newer. With no text there is nothing to read, and a flag left on the
  // active tab would send every later change to it to the text.
  it("with no text the flag still comes off, and the document is left alone", () => {
    useFileStore.setState({ openFiles: new Map() });

    rereadMissedReload("t1");

    expect(editor.state.doc.textContent).toBe("old text");
    expect(useEditorStore.getState().staleContentTabs).toEqual([]);
  });
});
