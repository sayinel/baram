/*
 * §3.6 충돌 모달은 충돌한 탭을 대상으로 한다 — 활성 탭이 아니다.
 *
 * 실제 `AppDialogs` 와 실제 `ConflictModalWrapper` 를 렌더하고, 충돌은 `useFileWatcher` 가
 * 등록한 진짜 `file:changed` 핸들러로 만든다. 무관한 lazy 대화상자는 stub 이다. MergeView 는
 * props 를 잡는 stub 이다.
 *
 * 장면 S: 활성 b(shared editor 에 "B body", dirty). 배경 a(dirty, `openFiles[a] = "A local"`).
 */
import type { ReactNode } from "react";

import type { MergeSegment } from "../../../ipc/types";
import type { EditorTab } from "../../../stores/editor/editor";
import type { Editor } from "@tiptap/core";

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChangedHandler = (e: {
  payload: { mtime: number; origin?: string; path: string };
}) => void;
let onFileChanged: ChangedHandler | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: unknown) => {
    if (name === "file:changed") onFileChanged = handler as ChangedHandler;
    return Promise.resolve(() => undefined);
  },
}));

const io = vi.hoisted(() => ({
  mergeTexts: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  readFile: (path: string) => io.readFile(path),
  updateFileIndex: () => Promise.resolve(),
  watchDir: () => Promise.resolve(),
  writeFile: (path: string, content: string) => io.writeFile(path, content),
}));

vi.mock("../../../ipc/snapshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/snapshot")>()),
  mergeTexts: (base: string, local: string, external: string) =>
    io.mergeTexts(base, local, external),
}));

/** MergeView stub — 마지막으로 받은 props 를 잡아 둔다. */
const merge = vi.hoisted(() => ({
  props: null as null | {
    filePath: string;
    onApply: (merged: string) => void;
    onCancel: () => void;
    segments: MergeSegment[];
  },
}));

vi.mock("../../editor/MergeView", () => ({
  MergeView: (props: NonNullable<typeof merge.props>) => {
    merge.props = props;
    return <div data-testid="merge-view">{props.filePath}</div>;
  },
}));

const { stub } = vi.hoisted(() => ({ stub: () => null }));
vi.mock("../../command/CommandPalette", () => ({ CommandPalette: stub }));
vi.mock("../../command/QuickSwitcher", () => ({ QuickSwitcher: stub }));
vi.mock("../../export/ExportDialog", () => ({ ExportDialog: stub }));
vi.mock("../../editor/HoverPreview", () => ({ HoverPreview: stub }));
vi.mock("../../editor/Toast", () => ({ ToastHost: stub }));
vi.mock("../../editor/UnsavedChangesModal", () => ({
  UnsavedChangesModal: stub,
}));
vi.mock("../../settings/SettingsModal", () => ({ SettingsModal: stub }));
vi.mock("../../settings/AboutModal", () => ({ AboutModal: stub }));
vi.mock("../../settings/UpdateDialog", () => ({ UpdateDialog: stub }));
vi.mock("../../ai/SkillGeneratorDialog", () => ({
  SkillGeneratorDialog: stub,
}));
vi.mock("../../ai/SkillTestDialog", () => ({ SkillTestDialog: stub }));
vi.mock("../../ai/SmartTemplateDialogWrapper", () => ({
  SmartTemplateDialogWrapper: stub,
}));
vi.mock("../../tasks/TaskEditDialog", () => ({ TaskEditDialog: stub }));
vi.mock("../../tasks/WeeklyReviewDialog", () => ({ WeeklyReviewDialog: stub }));
vi.mock("../../journal/QuickCaptureDialog", () => ({
  QuickCaptureDialog: stub,
}));
vi.mock("../../journal/ZettelTitleDialog", () => ({ ZettelTitleDialog: stub }));

import { makeTestEditor } from "../../../__tests__/helpers/make-test-editor";
import { shouldDeferSave } from "../../../hooks/use-auto-save";
import { useFileWatcher } from "../../../hooks/use-file-watcher";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import { AppDialogs } from "../AppDialogs";

const A = "/v/a.md";
const A2 = "/v/a2.md";
const B = "/v/b.md";
const C = "/v/c.md";

let shared: Editor;

const fileTab = (id: string, filePath: string, isDirty = true): EditorTab => ({
  contextId: "c",
  filePath,
  id,
  isDirty,
  isPinned: false,
  title: filePath.split("/").pop()!,
});

function Harness({ children }: { children?: ReactNode }) {
  useFileWatcher();
  return (
    <>
      <AppDialogs
        activeEditor={shared}
        handleCloseFolder={vi.fn()}
        handleNewFile={vi.fn()}
        handleOpenFile={vi.fn()}
        handleOpenFolder={vi.fn()}
        handleSave={vi.fn(async () => undefined)}
        handleSkillPreviewToggle={vi.fn()}
        handleToggleSourceMode={vi.fn()}
        markDirty={(id, dirty) =>
          useEditorStore.getState().markDirty(id, dirty)
        }
      />
      {children}
    </>
  );
}

async function mount() {
  const view = render(<Harness />);
  await waitFor(() => expect(onFileChanged).not.toBeNull());
  return view;
}

/** 워처가 올려 보내는 외부 변경 한 건. */
function externalChange(path: string, mtime: number) {
  act(() => {
    onFileChanged!({ payload: { mtime, origin: "external", path } });
  });
}

/** 지금 그려진 충돌 모달, 없으면 null. */
const conflictDialog = () =>
  screen.queryByRole("dialog", { name: "File Modified Externally" });

function click(dialog: HTMLElement, label: string) {
  act(() => {
    within(dialog).getByRole("button", { name: label }).click();
  });
}

async function expectConflictFor(name: string) {
  const dialog = await screen.findByRole("dialog", {
    name: "File Modified Externally",
  });
  expect(within(dialog).getByText(name)).toBeTruthy();
  return dialog;
}

beforeEach(() => {
  onFileChanged = null;
  merge.props = null;
  io.readFile.mockReset();
  io.readFile.mockResolvedValue("EXT1\n");
  io.writeFile.mockReset();
  io.writeFile.mockResolvedValue(undefined);
  io.mergeTexts.mockReset();
  io.mergeTexts.mockResolvedValue({ segments: [] });
  shared = makeTestEditor("<p>B body</p>");

  useUIStore.setState({ conflictQueue: [], toast: null });
  useFileStore.setState({
    fileMtimes: new Map([
      [A, { canReloadMtime: 0, lastSaveMtime: 1000 }],
      [C, { canReloadMtime: 0, lastSaveMtime: 1000 }],
    ]),
    fileTree: [],
    openFiles: new Map([
      [A, "A local\n"],
      [B, "B old\n"],
      [C, "C local\n"],
    ]),
  });
  useEditorStore.setState({
    activeTabId: "b",
    mruOrder: [],
    sourceEditedTabs: [],
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [fileTab("a", A), fileTab("b", B), fileTab("c", C)],
  });
});

afterEach(() => {
  shared.destroy();
});

describe("§3.6 conflicts are queued per tab", () => {
  it("f: a second conflict waits behind the first instead of replacing it", async () => {
    // 이것을 실패시키는 것: 큐를 한 칸으로(둘째 이벤트가 첫째를 덮는다).
    await mount();
    externalChange(A, 2000);
    externalChange(C, 2001);

    const first = await expectConflictFor("a.md");
    click(first, "Keep Local Edits");

    await expectConflictFor("c.md");
  });

  it("f2: a conflict that arrives while a merge is open does not cover it", async () => {
    // 이것을 실패시키는 것: wrapper 가 `suspended` 를 무시(새 모달이 merge view 위에 뜬다).
    await mount();
    externalChange(A, 2000);
    click(await expectConflictFor("a.md"), "Merge");
    await screen.findByTestId("merge-view");

    externalChange(C, 2001);

    expect(conflictDialog()).toBeNull();
    expect(useUIStore.getState().conflictQueue.map((e) => e.tabId)).toContain(
      "c",
    );
  });

  it("u: closing the tab drops its conflict; the reopened tab starts clean", async () => {
    // 이것을 실패시키는 것: 경로로 식별(같은 경로를 다시 연 탭에 옛 충돌이 남는다) / sweep 의
    // 인정(`canReloadMtime = 0`) 제거(다시 연 파일의 자동 저장이 영원히 미뤄진다).
    await mount();
    externalChange(A, 2000);
    await expectConflictFor("a.md");

    act(() => {
      useEditorStore.getState().closeTab("a");
      useEditorStore.getState().openTab(fileTab("a-new", A, false));
    });

    expect(conflictDialog()).toBeNull();
    expect(shouldDeferSave(useFileStore.getState().getFileMtime(A))).toBe(
      false,
    );
    expect(useFileStore.getState().getFileMtime(A)?.lastSaveMtime).toBe(1000);
  });

  it("u2: a renamed tab's conflict follows it, and closing it acknowledges the new path", async () => {
    // 이것을 실패시키는 것: `syncConflictTargets` 의 retarget 제거(모달이 옛 이름을 보이고,
    // 닫을 때 sweep 이 옛 경로 a 를 인정해 새 경로 a2 의 가드가 남는다).
    await mount();
    externalChange(A, 2000);
    await expectConflictFor("a.md");

    act(() => {
      useFileStore.getState().renameFileEntry(A, A2, "a2.md");
      useEditorStore.getState().renameTab(A, A2, "a2.md");
    });
    await expectConflictFor("a2.md");

    act(() => {
      useEditorStore.getState().closeTab("a");
      useEditorStore.getState().openTab(fileTab("a2-new", A2, false));
    });

    expect(conflictDialog()).toBeNull();
    expect(shouldDeferSave(useFileStore.getState().getFileMtime(A2))).toBe(
      false,
    );
  });

  it("u3: closing one tab keeps the guard while another tab of the path still claims it", async () => {
    // 같은 경로의 다른 탭 a-dup 이 이벤트 뒤에 편집을 얻었다(큐에는 없다). a 를 닫아도 a-dup 의
    // 저장 안 된 편집이 그 외부 변경과 갈라져 있으므로 가드를 풀면 안 된다.
    // 이것을 실패시키는 것: sweep 의 인정 조건에서 "unsaved 열린 탭" 검사 제거.
    useEditorStore.setState({
      tabs: [fileTab("a", A), fileTab("a-dup", A, false), fileTab("b", B)],
    });
    await mount();
    externalChange(A, 2000);
    act(() => useEditorStore.getState().markDirty("a-dup", true));

    act(() => useEditorStore.getState().closeTab("a"));

    expect(shouldDeferSave(useFileStore.getState().getFileMtime(A))).toBe(true);
  });

  it("u4: closing one tab keeps the guard while another queued conflict names the path", async () => {
    // a-dup 의 충돌이 아직 큐에 있다 — 그 충돌을 푸는 동작이 가드를 인정한다.
    // 이것을 실패시키는 것: sweep 의 인정 조건에서 "같은 경로의 다른 항목" 검사 제거.
    useEditorStore.setState({
      tabs: [fileTab("a", A), fileTab("a-dup", A), fileTab("b", B)],
    });
    await mount();
    externalChange(A, 2000);
    act(() => useEditorStore.getState().markDirty("a-dup", false));

    act(() => useEditorStore.getState().closeTab("a"));

    expect(useUIStore.getState().conflictQueue.map((e) => e.tabId)).toEqual([
      "a-dup",
    ]);
    expect(shouldDeferSave(useFileStore.getState().getFileMtime(A))).toBe(true);
  });
});
