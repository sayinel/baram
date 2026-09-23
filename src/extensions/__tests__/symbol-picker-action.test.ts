// §377 The slash menu's Symbols & Emoji item: open the picker at the caret,
// write the pick as typed text and record it — or write and record nothing.
// Real Editor and real mutation-tasks: mocking either would hide the gap
// (§12-9b) these tests are about. Only the picker itself is replaced.
import type { Extensions } from "@tiptap/core";

import { Editor, Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "..";
import { useSettingsStore } from "../../stores/settings/store";
import {
  countLiveEditorMutationTasks,
  invalidateEditorMutationTasks,
} from "../../utils/editor/mutation-tasks";
import { buildSlashItems } from "../plugins/slash-command-items";
import { pickSymbolIntoEditor } from "../plugins/symbol-picker-action";
import { symbolSuggestAllowed } from "../plugins/symbol-suggest";
import { isVimExternalEdit } from "../plugins/vim/vim-keys";
import { typeChars } from "./helpers/type-chars";

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

/**
 * Rejects any transaction that changes the document — the fixture's own
 * selection-only dispatch in `makeEditor` still passes. Simulates a
 * `filterTransaction` veto (e.g. an optimistic-lock plugin) downstream of the
 * chrome check, for the "record only when the document took it" guard.
 */
const RejectDocChanges = Extension.create({
  name: "rejectDocChanges",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: (tr) => !tr.docChanged,
        key: new PluginKey("rejectDocChanges"),
      }),
    ];
  },
});

/** An editor with the caret at the end of its first paragraph's text. */
function makeEditor(
  content = "<p>ab</p>",
  extraExtensions: Extensions = [],
): Editor {
  const editor = new Editor({
    content,
    extensions: [...createBaramExtensions(), ...extraExtensions],
  });
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

  it("writes and records nothing when a filterTransaction plugin rejects the write", async () => {
    // Negative twin of the test above ("writes the pick at the caret…"): that
    // one confirms recording when the write lands; this confirms nothing is
    // recorded when it's rejected downstream of the chrome check (plan:
    // "슬래시 경로는 문서가 실제로 바뀐 경우에만 — filterTransaction 이 거부하면
    // 아무것도 쓰이지 않는다").
    const editor = makeEditor("<p>ab</p>", [RejectDocChanges]);
    await pick(editor, "→");
    expect(editor.getText()).toBe("ab");
    expect(useSettingsStore.getState().recentSymbols).toEqual([]);
  });

  it("takes a stored mark, as typing there would", async () => {
    const editor = makeEditor();
    editor.commands.setBold();
    // Precondition: the empty selection carries bold as a stored mark, not
    // yet applied to any text — this is what discriminates an insert that
    // takes stored marks from one that drops them.
    expect(editor.state.storedMarks?.some((m) => m.type.name === "bold")).toBe(
      true,
    );
    await pick(editor, "→");
    expect(editor.getHTML()).toContain("ab<strong>→</strong>");
  });

  it("lands where typing would at the end of bold text", async () => {
    // SyntaxReveal (§5.1) expands the mark into literal `**` delimiters the
    // moment the caret rests at its end, before this action ever runs — so
    // both a typed character and a picked one land after the revealed `**`,
    // outside the (then re-collapsed) mark. Pin that shared landing spot
    // instead of asserting a fixed HTML string against SyntaxReveal's output.
    const typed = makeEditor("<p><strong>ab</strong></p>");
    typeChars(typed, "→");
    const picked = makeEditor("<p><strong>ab</strong></p>");
    await pick(picked, "→");
    expect(picked.getHTML()).toBe(typed.getHTML());
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
  let symbolSuggest: boolean;

  beforeEach(() => {
    symbolSuggest = useSettingsStore.getState().symbolSuggest;
  });

  afterEach(() => {
    useSettingsStore.setState({ symbolSuggest });
  });

  it("stays the last Basic item with the : autocomplete turned off", () => {
    // The symbolSuggest setting turns off only the `:` autocomplete — the slash
    // item is the explicit entrance and is always there (spec 0056 §377).
    useSettingsStore.setState({ symbolSuggest: false });
    const editor = makeEditor();
    // Precondition: the `:` entrance does read the setting as off here.
    expect(symbolSuggestAllowed(editor.state, { from: 3, to: 3 })).toBe(false);
    const basic = buildSlashItems(editor).filter((i) => i.category === "Basic");
    expect(basic.at(-1)?.id).toBe("symbols");
  });

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
