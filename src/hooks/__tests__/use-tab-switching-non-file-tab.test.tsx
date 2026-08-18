/*
 * §69 — switching TO a non-file tab must not run the content loader.
 *
 * ‼️ Written because a mutation exposed the hole: with the guard reverted to the old
 * graph-only check, this file was the only thing that would have caught it, and it did not
 * exist. Everything past that guard reads `filePath`, so a plugin tab (filePath "") fell into
 * the keep-alive lookup and then into the load path, which reaches `loadEditor.view`.
 *
 * The editor for the two non-file cases is a Proxy that throws on ANY property read: with the
 * guard the effect returns before touching it, so the assertion is not "some flag stayed
 * false" but "the editor was never touched at all".
 */

import { useRef } from "react";

import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A promise that never settles. The file-tab control below needs the loader to START
// (`setIsParsing(true)` is synchronous) without its async continuation running — that
// continuation would touch `editor.view` on a stub and reject, and vitest fails a run on an
// unhandled rejection even when every test passes.
vi.mock("../../pipeline/parse-async", () => ({
  parseMdastAsync: () => new Promise(() => undefined),
}));

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { createKeepalivePool } from "../use-large-doc-keepalive";
import { useTabSwitching } from "../use-tab-switching";

function harness(editor: Editor) {
  const onActiveEditorChange = vi.fn();
  const setIsParsing = vi.fn();
  const { result, rerender } = renderHook(() => {
    const appendHandleRef = useRef(null);
    const editorStateCache = useRef(new Map<string, EditorState>());
    const isNavBackForwardRef = useRef(false);
    useTabSwitching({
      appendHandleRef,
      createKeepaliveEditor: () => {
        throw new Error("the guard leaked: a keep-alive editor was created");
      },
      editor,
      editorStateCache,
      isNavBackForwardRef,
      getSourceBuffer: () => "",
      keepalive: createKeepalivePool(),
      onActiveEditorChange,
      setFindReplaceMode: vi.fn(),
      setFindReplaceOpen: vi.fn(),
      setIsParsing,
      setSourceBuffer: vi.fn(),
      sourceModeTabs: new Set<string>(),
    });
    return null;
  });
  return { onActiveEditorChange, rerender, result, setIsParsing };
}

function throwingEditor(): Editor {
  return new Proxy({} as Editor, {
    get(_t, prop) {
      throw new Error(
        `the guard leaked: the loader touched editor.${String(prop)}`,
      );
    },
  });
}

beforeEach(() => {
  useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
  useFileStore.setState({ openFiles: new Map() });
});

describe("useTabSwitching — a non-file tab (§69)", () => {
  it("resets the active editor and never reaches the loader for a plugin tab", () => {
    useEditorStore.getState().openPluginTab("baram-word-count", "Word Count");

    const { onActiveEditorChange, setIsParsing } = harness(throwingEditor());

    expect(onActiveEditorChange).toHaveBeenCalledWith(null);
    expect(setIsParsing).not.toHaveBeenCalled();
  });

  it("does the same for a graph tab", () => {
    // The behaviour the old check had, kept explicit so the inversion cannot regress it.
    useEditorStore.getState().openGraphTab();

    const { onActiveEditorChange } = harness(throwingEditor());

    expect(onActiveEditorChange).toHaveBeenCalledWith(null);
  });

  it("DOES reach the loader for a file tab — the guard is not a blanket return", () => {
    // Non-vacuity. Without this, both tests above pass against an effect that returns
    // immediately for everything.
    //
    // ‼️ The content matters: the loader is wrapped in `if (content !== undefined)`, so with
    // an empty `openFiles` this control passed for the wrong reason — nothing was loaded
    // because there was nothing to load, not because the tab was a file tab.
    useFileStore.setState({ openFiles: new Map([["/vault/a.md", "# hi"]]) });
    const benign = {} as Editor;
    useEditorStore.setState({
      activeTabId: "t1",
      mruOrder: ["t1"],
      tabs: [
        {
          contextId: "ctx",
          filePath: "/vault/a.md",
          id: "t1",
          isDirty: false,
          isPinned: false,
          title: "a.md",
        },
      ],
    });

    const { setIsParsing } = harness(benign);

    expect(setIsParsing).toHaveBeenCalledWith(true);
  });
});
