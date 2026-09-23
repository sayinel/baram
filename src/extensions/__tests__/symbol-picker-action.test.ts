// §377 The slash menu's Symbols & Emoji item: open the picker at the caret,
// write the pick as typed text and record it — or write and record nothing.
// Real Editor and real mutation-tasks: mocking either would hide the gap
// (§12-9b) these tests are about. Only the picker itself is replaced.
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "..";
import { useSettingsStore } from "../../stores/settings/store";
import {
  countLiveEditorMutationTasks,
  invalidateEditorMutationTasks,
} from "../../utils/editor/mutation-tasks";
import { buildSlashItems } from "../plugins/slash-command-items";
import { pickSymbolIntoEditor } from "../plugins/symbol-picker-action";
import { isVimExternalEdit } from "../plugins/vim/vim-keys";

vi.mock("../../components/command/show-symbol-picker", () => ({
  showSymbolPicker: vi.fn(),
}));

import { showSymbolPicker } from "../../components/command/show-symbol-picker";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Let the awaited picker continuation run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const editors: Editor[] = [];

/** An editor with the caret at the end of its first paragraph's text. */
function makeEditor(content = "<p>ab</p>"): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)),
  );
  return editor;
}

/** Open the picker through `run`, then answer it with `answer` after `meanwhile`. */
async function pick(
  editor: Editor,
  answer: null | string,
  run: () => unknown = () => pickSymbolIntoEditor(editor),
  meanwhile: () => void = () => {},
): Promise<void> {
  const gate = deferred<null | string>();
  vi.mocked(showSymbolPicker).mockReturnValueOnce(gate.promise);
  const running = run();
  await flush();
  meanwhile();
  gate.resolve(answer);
  await running;
}

beforeEach(() => {
  useSettingsStore.setState({ recentSymbols: [] });
});

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  vi.clearAllMocks();
});

describe("pickSymbolIntoEditor (§377)", () => {
  it("writes the pick at the caret, tagged as a chrome edit, and records it", async () => {
    const editor = makeEditor();
    const tagged: boolean[] = [];
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) tagged.push(isVimExternalEdit(transaction));
    });
    await pick(editor, "→");
    expect(editor.getText()).toBe("ab→");
    expect(tagged).toEqual([true]);
    expect(useSettingsStore.getState().recentSymbols).toEqual(["→"]);
    expect(countLiveEditorMutationTasks(editor.view)).toBe(0);
  });

  it("takes the marks at the caret, as typing there would", async () => {
    const editor = makeEditor("<p><strong>ab</strong></p>");
    await pick(editor, "→");
    expect(editor.getHTML()).toContain("<strong>ab→</strong>");
  });

  it("writes and records nothing when the picker is cancelled", async () => {
    const editor = makeEditor();
    await pick(editor, null);
    expect(editor.getText()).toBe("ab");
    expect(useSettingsStore.getState().recentSymbols).toEqual([]);
  });

  it("writes nothing when another document was installed meanwhile", async () => {
    const editor = makeEditor();
    // What replaceEditorStateWithVim does synchronously before installing a tab's state.
    await pick(editor, "→", undefined, () =>
      invalidateEditorMutationTasks(editor.view),
    );
    expect(editor.getText()).toBe("ab");
    expect(useSettingsStore.getState().recentSymbols).toEqual([]);
  });

  it("writes nothing when the editor turned read-only meanwhile", async () => {
    const editor = makeEditor();
    await pick(editor, "→", undefined, () => editor.setEditable(false));
    expect(editor.getText()).toBe("ab");
    expect(useSettingsStore.getState().recentSymbols).toEqual([]);
  });
});

describe("the Symbols & Emoji slash item (§377)", () => {
  it("is the last Basic item and opens the picker", async () => {
    const editor = makeEditor();
    const basic = buildSlashItems(editor).filter((i) => i.category === "Basic");
    expect(basic.slice(-2).map((i) => i.id)).toEqual([
      "definition-list",
      "symbols",
    ]);
    const item = basic.at(-1);
    if (!item) throw new Error("no Basic items");
    await pick(editor, "→", () => item.action());
    expect(editor.getText()).toBe("ab→");
  });
});
