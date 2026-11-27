// §3.6 충돌 모달의 "병합"은 그 파일을 보이는 탭의 글을 병합하고, 그 탭에만 적용한다.
//
// 워처는 dirty 탭의 파일이 밖에서 바뀌면 그 탭이 활성인지 보지 않고 충돌 모달을 연다
// (`use-file-watcher.ts`). 예전 병합은 내 쪽 글을 활성 편집기의 문서로 지었고, 적용은 활성 탭을 그
// `openFiles` 로 다시 읽고 활성 탭의 표시를 내렸다 — 충돌한 파일이 배경 탭이면 다른 탭의 문서가 그
// 파일에 쓰였고, 활성 탭의 저장 안 한 편집이 말없이 사라졌다. 3-way 의 기준(base)도 `openFiles` 였는데,
// 떠난 탭은 저장 안 한 편집을 거기 넣으므로 병합이 그 편집을 묻지 않고 되돌렸다. 이제 base 는 앱이
// 디스크에 있다고 아는 마지막 글(`diskTexts`)이다.
//
// 앱이 묶는 대로 실제 훅(`auto-save-tab-left-during-debounce` 의 하네스 + `useEditorEffects` +
// `useFileWatcher`)과 실제 `AppDialogs` · `ConflictModal` · `MergeView` 를 묶는다. 가짜는 IPC, 이벤트
// 구독, 다른 대화상자, 앱이 넘기는 콜백이다. `mergeTexts`(Rust 3-way 병합)도 가짜다: 파일 전체를 충돌
// 하나로 돌려줘 사용자가 한쪽을 고르게 한다 — 여기서 보는 것은 병합 알고리즘이 아니라 무엇이 병합에
// 들어가고, 적용이 어디에 쓰고 무엇을 그대로 두는가다.
import { useRef } from "react";

import type { ProgressiveLoadHandle } from "../../../utils/editor/progressive-load";
import type { Editor } from "@tiptap/core";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, string>();
const written: [string, string][] = [];
/** Paths whose next write fails — a disk that refuses the merge. */
const failingWrites = new Set<string>();
/** Holds the next read of a path until the test lets it go. */
const heldReads = new Map<string, Promise<void>>();
const listeners = new Map<string, (event: { payload: unknown }) => unknown>();
const mergeTexts = vi.hoisted(() =>
  vi.fn(async (base: string, local: string, external: string) => ({
    segments: [
      {
        base: base.split("\n"),
        external: external.split("\n"),
        kind: "conflict" as const,
        local: local.split("\n"),
      },
    ],
  })),
);

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => unknown) => {
    listeners.set(name, handler);
    return Promise.resolve(() => listeners.delete(name));
  },
}));
vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  readFile: async (path: string) => {
    const held = heldReads.get(path);
    heldReads.delete(path);
    if (held) await held;
    return disk.get(path) ?? "";
  },
  updateFileIndex: () => Promise.resolve(),
  watchDir: () => Promise.resolve(),
  writeFile: (path: string, content: string) => {
    if (failingWrites.delete(path)) return Promise.reject(new Error("EACCES"));
    written.push([path, content]);
    disk.set(path, content);
    return Promise.resolve();
  },
}));
vi.mock("../../../ipc/snapshot", () => ({ mergeTexts }));

// The other dialogs `AppDialogs` hosts are not on this path.
const nothing = vi.hoisted(() => () => null);
vi.mock("../../command/CommandPalette", () => ({ CommandPalette: nothing }));
vi.mock("../../command/QuickSwitcher", () => ({ QuickSwitcher: nothing }));
vi.mock("../../export/ExportDialog", () => ({ ExportDialog: nothing }));
vi.mock("../../editor/HoverPreview", () => ({ HoverPreview: nothing }));
vi.mock("../../editor/Toast", () => ({ ToastHost: nothing }));
vi.mock("../../editor/UnsavedChangesModal", () => ({
  UnsavedChangesModal: nothing,
}));
vi.mock("../../settings/SettingsModal", () => ({ SettingsModal: nothing }));
vi.mock("../../settings/AboutModal", () => ({ AboutModal: nothing }));
vi.mock("../../settings/UpdateDialog", () => ({ UpdateDialog: nothing }));
vi.mock("../../ai/SkillGeneratorDialog", () => ({
  SkillGeneratorDialog: nothing,
}));
vi.mock("../../ai/SkillTestDialog", () => ({ SkillTestDialog: nothing }));
vi.mock("../../ai/SmartTemplateDialogWrapper", () => ({
  SmartTemplateDialogWrapper: nothing,
}));
vi.mock("../../tasks/TaskEditDialog", () => ({ TaskEditDialog: nothing }));
vi.mock("../../tasks/WeeklyReviewDialog", () => ({
  WeeklyReviewDialog: nothing,
}));
vi.mock("../../journal/QuickCaptureDialog", () => ({
  QuickCaptureDialog: nothing,
}));
vi.mock("../../journal/ZettelTitleDialog", () => ({
  ZettelTitleDialog: nothing,
}));

import { makeTestEditor } from "../../../__tests__/helpers/make-test-editor";
import { useAutoSave } from "../../../hooks/use-auto-save";
import { useEditorEffects } from "../../../hooks/use-editor-effects";
import { useFileWatcher } from "../../../hooks/use-file-watcher";
import { useKeepaliveEditors } from "../../../hooks/use-keepalive-editors";
import { useSourceMode } from "../../../hooks/use-source-mode";
import { useTabSwitching } from "../../../hooks/use-tab-switching";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import {
  clearOriginalDoc,
  loadedTabId,
} from "../../../utils/editor/programmatic-update";
import { serializeLiveDoc } from "../../../utils/editor/serialize-live-doc";
import { AppDialogs } from "../AppDialogs";

const NOTE = "/v/note.md";
const OTHER = "/v/other.md";
const COPY = "/v/copy.txt";
const NOTE_TEXT = "# NOTE\n\nnote body\n";
const OTHER_TEXT = "# OTHER\n\nother body\n";
const COPY_TEXT = "COPY first\n";
/** What another program wrote into NOTE, in place (the watcher reports that as `file:changed`). */
const NOTE_CHANGED = "# NOTE\n\nchanged elsewhere\n";

const fileTab = (id: string, filePath: string) => ({
  contextId: "c",
  filePath,
  id,
  isDirty: false,
  isPinned: false,
  title: id,
});

const noop = () => undefined;
const inlineAI = { applyContent: noop, previewInsertAfterSelection: noop };
let editor: Editor;
let view: null | ReturnType<typeof render> = null;

/** The editing surface `App.tsx` wires, its watcher and effects, and its dialog host. */
function Surface() {
  const { activeEditor, keepalive, onActiveEditorChange } =
    useKeepaliveEditors(editor);
  useAutoSave(activeEditor);
  const appendHandleRef = useRef<null | {
    handle: ProgressiveLoadHandle;
    tabId: string;
  }>(null);
  const isNavBackForwardRef = useRef(false);
  const scrollOffsets = useRef(new Map<string, number>());
  const source = useSourceMode({
    appendHandleRef,
    editor: activeEditor,
    pool: keepalive,
  });
  useTabSwitching({
    appendHandleRef,
    createKeepaliveEditor: () => makeTestEditor("<p></p>"),
    editor,
    editorStateCache: source.editorStateCache,
    getSourceBuffer: source.getSourceBuffer,
    isNavBackForwardRef,
    keepalive,
    onActiveEditorChange,
    scrollOffsets,
    setFindReplaceMode: noop,
    setFindReplaceOpen: noop,
    setIsParsing: noop,
    setSourceBuffer: source.setSourceBuffer,
    sourceModeTabs: source.sourceModeTabs,
  });
  useEditorEffects({
    editor: activeEditor,
    editorStateCache: source.editorStateCache,
    inlineAI,
    setFindReplaceMode: noop,
    setFindReplaceOpen: noop,
  });
  useFileWatcher();
  return (
    <AppDialogs
      activeEditor={activeEditor}
      handleCloseFolder={noop}
      handleNewFile={noop}
      handleNewNamedFile={noop}
      handleOpenFile={noop}
      handleOpenFolder={noop}
      handleSave={() => Promise.resolve()}
      handleSkillPreviewToggle={noop}
      handleToggleSourceMode={noop}
    />
  );
}

const settle = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

const show = (id: string) => {
  act(() => {
    useEditorStore.setState({ activeTabId: id });
  });
};

const installed = (id: string) =>
  waitFor(() => expect(loadedTabId()).toBe(id), { timeout: 5000 });

const typeInto = (target: Editor, text: string) => {
  act(() => {
    target.view.dispatch(target.state.tr.insertText(text, 1));
  });
};

const dirty = (id: string) =>
  useEditorStore.getState().tabs.find((t) => t.id === id)?.isDirty;

/** Another program writes `path` in place, and the watcher reports it. */
async function changeElsewhere(path: string, text: string) {
  disk.set(path, text);
  await waitFor(() => expect(listeners.has("file:changed")).toBe(true));
  await act(async () => {
    await listeners.get("file:changed")!({
      payload: { mtime: Date.now() + 10_000, origin: "external", path },
    });
  });
}

/** Merge from the conflict modal, take one side of the conflict, and apply. */
async function mergeTaking(side: "내 것" | "외부", path = NOTE) {
  fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
  fireEvent.click(await screen.findByRole("button", { name: side }));
  fireEvent.click(screen.getByRole("button", { name: "Apply Merge" }));
  await waitFor(() => expect(written.some(([p]) => p === path)).toBe(true));
  await settle(100);
}

/** NOTE has an unsaved edit in the background; OTHER is active with one of its own. */
async function backgroundConflict() {
  view = render(<Surface />);
  await installed("t1");
  typeInto(editor, "x");
  show("t3");
  await installed("t3");
  typeInto(editor, "y");
  expect(dirty("t1")).toBe(true);
  expect(dirty("t3")).toBe(true);
  // The precondition of the base: leaving NOTE put its unsaved edit into `openFiles`.
  expect(useFileStore.getState().openFiles.get(NOTE)).toBe(
    "# xNOTE\n\nnote body\n",
  );
  await changeElsewhere(NOTE, NOTE_CHANGED);
  expect(useUIStore.getState().conflictModal?.filePath).toBe(NOTE);
}

beforeEach(() => {
  disk.clear();
  written.length = 0;
  failingWrites.clear();
  heldReads.clear();
  mergeTexts.mockClear();
  editor = makeTestEditor("<p></p>");
  // Off, so a tab with unsaved edits stays that way in the background — with it on, that lasts
  // only until the tab's save comes due (§3.6, #1017).
  useSettingsStore.setState({ autoSave: false });
  disk.set(NOTE, NOTE_TEXT);
  disk.set(OTHER, OTHER_TEXT);
  disk.set(COPY, COPY_TEXT);
  const opened = new Map([
    [COPY, COPY_TEXT],
    [NOTE, NOTE_TEXT],
    [OTHER, OTHER_TEXT],
  ]);
  useFileStore.setState({
    // What opening each file records when its tab appears (`noteFilesShown`).
    diskTexts: new Map(opened),
    fileMtimes: new Map(),
    openFiles: opened,
    rootPath: "/v",
  });
  useEditorStore.setState({
    activeTabId: "t1",
    contentRefreshKey: 0,
    mruOrder: ["t1"],
    sourceBufferAccess: null,
    sourceEditedTabs: [],
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [fileTab("t1", NOTE), fileTab("t2", COPY), fileTab("t3", OTHER)],
  });
  useUIStore.setState({ conflictModal: null, contentReloadVersion: 0 });
  for (const id of ["t1", "t2", "t3"]) clearOriginalDoc(id);
});

afterEach(async () => {
  act(() => {
    useEditorStore.setState({ activeTabId: null, tabs: [] });
  });
  await waitFor(() => expect(editor.state.doc.textContent).toBe(""));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  view?.unmount();
  view = null;
  editor.destroy();
});

describe("merging from the conflict modal", { timeout: 20000 }, () => {
  // The control: the conflicted file is the active tab. Its disk text is the base, its document is
  // the local side, and the apply writes what was chosen, shows it and takes the mark down.
  it("merges the active tab's own document when the conflicted file is the active tab", async () => {
    view = render(<Surface />);
    await installed("t1");
    typeInto(editor, "x");
    await changeElsewhere(NOTE, NOTE_CHANGED);

    await mergeTaking("내 것");

    expect(mergeTexts).toHaveBeenCalledWith(
      NOTE_TEXT,
      "# xNOTE\n\nnote body\n",
      NOTE_CHANGED,
    );
    expect(disk.get(NOTE)).toBe("# xNOTE\n\nnote body\n");
    expect(serializeLiveDoc(editor)).toBe("# xNOTE\n\nnote body\n");
    expect(dirty("t1")).toBe(false);
  });

  // What fails this: the local side from the active editor (it was OTHER's document), or the base
  // from `openFiles` (it was NOTE's own unsaved text, so the merge would see no local change and take
  // the other program's side for every line).
  it("merges the conflicted tab's document against its disk text when that tab is in the background", async () => {
    await backgroundConflict();

    fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
    await waitFor(() => expect(mergeTexts).toHaveBeenCalled());

    expect(mergeTexts).toHaveBeenCalledWith(
      NOTE_TEXT,
      "# xNOTE\n\nnote body\n",
      NOTE_CHANGED,
    );
  });

  // What fails this: reading the local side where the tab's save reads (`saveSource`), which refuses a
  // cached document whose text says something else — the merge could then never start. The cache is
  // still the tab's document; what reached the text only is on the other side, from the disk.
  it("merges the cached document even when the tab's text says something else", async () => {
    await backgroundConflict();
    act(() =>
      useFileStore
        .getState()
        .setFileContent(NOTE, "# xNOTE\n\nnote body\n\n- [x] task\n"),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
    await waitFor(() => expect(mergeTexts).toHaveBeenCalled());

    expect(mergeTexts.mock.calls[0][1]).toBe("# xNOTE\n\nnote body\n");
  });

  it("writes the conflicted tab's side into its file, not the active tab's document", async () => {
    await backgroundConflict();

    await mergeTaking("내 것");

    expect(disk.get(NOTE)).toBe("# xNOTE\n\nnote body\n");
  });

  // What fails this: the apply reloading and marking the active tab — what it did before. Even
  // taking the other program's side, the choice that keeps nothing of the local side.
  it("leaves the active tab's unsaved edit and its mark alone", async () => {
    await backgroundConflict();

    await mergeTaking("외부");

    expect(disk.get(NOTE)).toBe(NOTE_CHANGED);
    expect(serializeLiveDoc(editor)).toBe("# yOTHER\n\nother body\n");
    expect(dirty("t3")).toBe(true);
    expect(writesTo(OTHER)).toEqual([]);
  });

  // What fails this: an apply that leaves the conflicted tab's cached document to come back, or that
  // does not record the merge as the disk text. The other side is taken, so the merge differs from
  // the cache the tab left with; only the apply records it (the merge start records nothing).
  it("takes the conflicted tab's mark down, and the tab shows the merge when it comes back", async () => {
    await backgroundConflict();

    await mergeTaking("외부");

    expect(dirty("t1")).toBe(false);
    expect(useFileStore.getState().diskTexts.get(NOTE)).toBe(NOTE_CHANGED);
    show("t1");
    await installed("t1");
    expect(serializeLiveDoc(editor)).toBe(NOTE_CHANGED);
  });

  // What fails this: leaving the modal closed after a failed write — the file's saves stay held off
  // (`shouldDeferSave`) with no way to answer. Nothing is recorded and the tab keeps its edit.
  it("asks again when the merge cannot be written, and leaves the tab as it was", async () => {
    await backgroundConflict();
    failingWrites.add(NOTE);

    fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
    fireEvent.click(await screen.findByRole("button", { name: "내 것" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply Merge" }));

    await waitFor(() =>
      expect(useUIStore.getState().conflictModal?.filePath).toBe(NOTE),
    );
    expect(useUIStore.getState().toast?.type).toBe("error");
    expect(disk.get(NOTE)).toBe(NOTE_CHANGED);
    expect(useFileStore.getState().diskTexts.get(NOTE)).toBe(NOTE_TEXT);
    expect(dirty("t1")).toBe(true);
  });

  // What fails this: writing the merge when the file changed again while the merge view was open —
  // that change would be gone. The newer conflict is on screen, and the merge is not written.
  it("does not write a merge over a change made while the merge view was open", async () => {
    await backgroundConflict();
    fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
    fireEvent.click(await screen.findByRole("button", { name: "내 것" }));
    await changeElsewhere(NOTE, "# NOTE\n\nchanged again\n");

    fireEvent.click(screen.getByRole("button", { name: "Apply Merge" }));
    await settle(50);

    expect(written.some(([p]) => p === NOTE)).toBe(false);
    expect(disk.get(NOTE)).toBe("# NOTE\n\nchanged again\n");
    expect(useUIStore.getState().conflictModal?.filePath).toBe(NOTE);
  });

  // What fails this: asking again about a conflict answered meanwhile — its saves are no longer held.
  it("does not ask again once the conflict is no longer holding saves", async () => {
    await backgroundConflict();
    fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
    await screen.findByRole("button", { name: "Cancel" });
    act(() => {
      const entry = useFileStore.getState().getFileMtime(NOTE)!;
      useFileStore
        .getState()
        .updateLastSaveMtime(NOTE, entry.canReloadMtime, null);
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useUIStore.getState().conflictModal).toBeNull();
  });

  // What fails this: asking again over the conflict on screen. Another file's conflict arrived while
  // the merge view was open; it is answered first, then this file's is asked.
  it("asks again after the conflict on screen is answered, not over it", async () => {
    await backgroundConflict();
    fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
    await screen.findByRole("button", { name: "Cancel" });
    await changeElsewhere(OTHER, "# OTHER\n\nchanged elsewhere\n");
    expect(useUIStore.getState().conflictModal?.filePath).toBe(OTHER);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useUIStore.getState().conflictModal?.filePath).toBe(OTHER);

    fireEvent.click(
      await screen.findByRole("button", { name: "Keep Local Edits" }),
    );
    await waitFor(() =>
      expect(useUIStore.getState().conflictModal?.filePath).toBe(NOTE),
    );
  });

  // What fails this: the local side from the active editor's document for a tab whose text is its
  // source buffer — a non-markdown file.
  it("merges a non-markdown tab's source buffer", async () => {
    view = render(<Surface />);
    await installed("t1");
    show("t2");
    await waitFor(() =>
      expect(
        useEditorStore.getState().sourceBufferAccess?.getSourceBuffer("t2"),
      ).toBe(COPY_TEXT),
    );
    act(() => {
      useEditorStore
        .getState()
        .sourceBufferAccess!.setSourceBuffer("t2", "COPY edited\n");
      useEditorStore.getState().markDirty("t2", true);
    });
    await changeElsewhere(COPY, "COPY elsewhere\n");

    await mergeTaking("외부", COPY);

    expect(mergeTexts).toHaveBeenCalledWith(
      COPY_TEXT,
      "COPY edited\n",
      "COPY elsewhere\n",
    );
    expect(disk.get(COPY)).toBe("COPY elsewhere\n");
    expect(
      useEditorStore.getState().sourceBufferAccess?.getSourceBuffer("t2"),
    ).toBe("COPY elsewhere\n");
    expect(dirty("t2")).toBe(false);
  });
});

describe("the base of the next merge", { timeout: 20000 }, () => {
  // What fails this: keeping the base from before the change after "Keep Local Edits". The disk holds
  // the other program's text until the tab saves; a later merge from the older base would bring back
  // what was declined as the other side's own change.
  it("is the other program's text once the local edits are kept", async () => {
    await backgroundConflict();

    fireEvent.click(
      await screen.findByRole("button", { name: "Keep Local Edits" }),
    );

    await waitFor(() =>
      expect(useFileStore.getState().diskTexts.get(NOTE)).toBe(NOTE_CHANGED),
    );
    expect(dirty("t1")).toBe(true);
  });

  // What fails this: recording what the read found when another change was reported while it ran —
  // nobody declined that one. The base stays, and the newer change is asked about.
  it("is left when the file changed again while the kept text was being read", async () => {
    await backgroundConflict();
    let release!: () => void;
    heldReads.set(
      NOTE,
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Keep Local Edits" }),
    );
    await changeElsewhere(NOTE, "# NOTE\n\nchanged again\n");
    release();
    await settle(20);

    expect(useFileStore.getState().diskTexts.get(NOTE)).toBe(NOTE_TEXT);
    expect(useUIStore.getState().conflictModal?.filePath).toBe(NOTE);
  });

  // What fails this: sending a recorded empty base to the 3-way merge — the same two insertions at one
  // place, kept one after the other without asking.
  it("is a whole-file question when the recorded text is empty", async () => {
    act(() => {
      const diskTexts = new Map(useFileStore.getState().diskTexts);
      diskTexts.set(NOTE, "");
      useFileStore.setState({ diskTexts });
    });
    view = render(<Surface />);
    await installed("t1");
    typeInto(editor, "x");
    await changeElsewhere(NOTE, NOTE_CHANGED);
    expect(useUIStore.getState().conflictModal?.base).toBe("");

    await mergeTaking("외부");

    expect(mergeTexts).not.toHaveBeenCalled();
    expect(disk.get(NOTE)).toBe(NOTE_CHANGED);
  });

  // What fails this: recording the other program's text when the merge starts. Cancelled, the merge
  // leaves the tab's text descending from the old disk text; with the new one as base, the next merge
  // would read the tab as taking the other program's change back, and drop it without asking.
  it("stays the old disk text when the merge is cancelled, and the modal asks again", async () => {
    await backgroundConflict();

    fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(useFileStore.getState().diskTexts.get(NOTE)).toBe(NOTE_TEXT);
    expect(useUIStore.getState().conflictModal).toMatchObject({
      base: NOTE_TEXT,
      filePath: NOTE,
    });
  });

  // What fails this: sending an absent base to the 3-way merge as "". It reads that as two insertions
  // at one place and keeps both, one after the other, without asking. With nothing recorded the whole
  // file is one question instead.
  it("is none when nothing was recorded, and the merge asks about the whole file", async () => {
    act(() => {
      const diskTexts = new Map(useFileStore.getState().diskTexts);
      diskTexts.delete(NOTE);
      useFileStore.setState({ diskTexts });
    });
    view = render(<Surface />);
    await installed("t1");
    typeInto(editor, "x");
    await changeElsewhere(NOTE, NOTE_CHANGED);
    expect(useUIStore.getState().conflictModal?.base).toBeNull();

    await mergeTaking("외부");

    expect(mergeTexts).not.toHaveBeenCalled();
    expect(disk.get(NOTE)).toBe(NOTE_CHANGED);
  });
});

function writesTo(path: string) {
  return written.filter(([p]) => p === path).map(([, content]) => content);
}
