// issue 594 — the deferred restore installs the cache entry as it is when the
// timer FIRES, not the one captured when the switch was scheduled. A block ID
// rename the backend commits in between lands in the cache; the captured
// snapshot would put the old ID back on screen and the next switch would cache
// that over the rename.
import type { EditorTab } from "../../../stores/editor/editor";
import type { TabSwitchContext } from "../types";

import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../extensions/plugins/vim/replace-editor-state", () => ({
  replaceEditorStateWithVim: vi.fn(),
}));
vi.mock("../after-doc-load", () => ({ afterDocLoad: vi.fn() }));

import { replaceEditorStateWithVim } from "../../../extensions/plugins/vim/replace-editor-state";
import { restoreCachedState } from "../restore-cached-state";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    text: {},
  },
});

function stateWith(text: string): EditorState {
  return EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text(text)]),
    ]),
    schema,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(replaceEditorStateWithVim).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("restoreCachedState", () => {
  it("installs the cache entry current at fire time", () => {
    const scheduled = stateWith("scheduled");
    const cache = new Map<string, EditorState>([["t1", scheduled]]);
    const ctx = {
      editor: { view: { dom: document.createElement("div") } },
      editorStateCache: { current: cache },
      installContent: vi.fn(),
      scrollOffsets: { current: new Map<string, number>() },
    } as unknown as TabSwitchContext;
    const tab = { filePath: "/v/a.md", id: "t1", type: "file" } as EditorTab;

    restoreCachedState(ctx, "t1", tab, "", scheduled);
    // Between scheduling and firing, a committed rename replaced the entry.
    const renamed = stateWith("renamed");
    cache.set("t1", renamed);
    vi.runAllTimers();

    expect(replaceEditorStateWithVim).toHaveBeenCalledTimes(1);
    expect(vi.mocked(replaceEditorStateWithVim).mock.calls[0]![1]).toBe(
      renamed,
    );
    expect(ctx.installContent).toHaveBeenCalledWith("t1", "/v/a.md");
  });

  it("falls back to the scheduled state when the entry was dropped meanwhile", () => {
    const scheduled = stateWith("scheduled");
    const cache = new Map<string, EditorState>([["t1", scheduled]]);
    const ctx = {
      editor: { view: { dom: document.createElement("div") } },
      editorStateCache: { current: cache },
      installContent: vi.fn(),
      scrollOffsets: { current: new Map<string, number>() },
    } as unknown as TabSwitchContext;
    const tab = { filePath: "/v/a.md", id: "t1", type: "file" } as EditorTab;

    restoreCachedState(ctx, "t1", tab, "", scheduled);
    cache.delete("t1");
    vi.runAllTimers();

    expect(vi.mocked(replaceEditorStateWithVim).mock.calls[0]![1]).toBe(
      scheduled,
    );
  });
});
