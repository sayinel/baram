/*
 * §3.6 충돌 모달은 충돌한 탭을 대상으로 한다 — 활성 탭이 아니다.
 *
 * 실제 `AppDialogs` 와 실제 `ConflictModalWrapper` 를 렌더하고, 충돌은 `useFileWatcher` 가
 * 등록한 진짜 `file:changed` 핸들러로 만든다. 무관한 lazy 대화상자는 stub 이다. MergeView 는
 * props 를 잡는 stub 이다. 장면은 `conflict-scene.ts` 의 S 다.
 */
import type { ReactNode } from "react";

import type { Locale } from "../../../i18n";
import type { MergeSegment } from "../../../ipc/types";

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
    busy?: boolean;
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

import { shouldDeferSave } from "../../../hooks/use-auto-save";
import { useFileWatcher } from "../../../hooks/use-file-watcher";
import { t } from "../../../i18n";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import {
  markContentLoaded,
  setTabLoading,
} from "../../../utils/editor/programmatic-update";
import { AppDialogs } from "../AppDialogs";
import {
  A,
  A2,
  B,
  buffers,
  C,
  cacheTab,
  deferred,
  disk,
  fileTab,
  isDirty,
  NOW,
  queueIds,
  setupScene,
  sharedText,
  teardownScene,
} from "./conflict-scene";

let shared: ReturnType<typeof setupScene>["shared"];

async function applyMerge(merged: string) {
  await waitFor(() => expect(merge.props).not.toBeNull());
  await act(async () => {
    merge.props!.onApply(merged);
  });
  await settle();
}

function cancelMerge() {
  act(() => merge.props!.onCancel());
}

function click(dialog: HTMLElement, label: string) {
  act(() => {
    within(dialog).getByRole("button", { name: label }).click();
  });
}

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
      />
      {children}
    </>
  );
}

/** 지금 그려진 충돌 모달, 없으면 null. */
const conflictDialog = () =>
  screen.queryByRole("dialog", { name: "File Modified Externally" });

async function expectConflictFor(name: string) {
  const dialog = await screen.findByRole("dialog", {
    name: "File Modified Externally",
  });
  expect(within(dialog).getByText(name)).toBeTruthy();
  return dialog;
}

/** 워처가 올려 보내는 외부 변경 한 건. */
function externalChange(path: string, mtime: number) {
  act(() => {
    onFileChanged!({ payload: { mtime, origin: "external", path } });
  });
}

async function mount() {
  const view = render(<Harness />);
  await waitFor(() => expect(onFileChanged).not.toBeNull());
  return view;
}

async function pressMerge() {
  click(await expectConflictFor("a.md"), "Merge");
  await settle();
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const toastFor = (key: string, name: string) =>
  t(key, useSettingsStore.getState().locale as Locale, { name });

beforeEach(() => {
  onFileChanged = null;
  merge.props = null;
  ({ shared } = setupScene());
  io.readFile.mockReset();
  io.readFile.mockImplementation(async (path: string) => {
    if (!disk.has(path)) throw new Error(`ENOENT ${path}`);
    return disk.get(path)!;
  });
  io.writeFile.mockReset();
  io.writeFile.mockImplementation(async (path: string, content: string) => {
    disk.set(path, content);
  });
  io.mergeTexts.mockReset();
  io.mergeTexts.mockImplementation(
    async (base: string, local: string, external: string) => ({
      segments: [
        {
          base: [base],
          external: [external],
          kind: "conflict",
          local: [local],
        },
      ],
    }),
  );
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  teardownScene();
});

describe("§3.6 Merge reads the conflicted tab, not the active one", () => {
  it("a: a background conflict merges the background tab's text", async () => {
    // 이것을 실패시키는 것: local 을 `serializeLiveDoc(activeEditor)` 로 읽음("B body").
    await mount();
    externalChange(A, 2000);
    await pressMerge();

    expect(io.mergeTexts).toHaveBeenCalledWith(
      "A local\n",
      "A local\n",
      "EXT1\n",
    );
  });

  it("a2: the active tab whose document is not installed yet reads its cache", async () => {
    // 활성 a 인데 shared editor 에는 아직 b 가 설치돼 있다(`loadedTabId() === "b"`).
    // 이것을 실패시키는 것: shared editor 판정을 `activeTabId === id` 로(그러면 "B body").
    useEditorStore.setState({ activeTabId: "a" });
    await mount();
    externalChange(A, 2000);
    await pressMerge();

    expect(io.mergeTexts.mock.calls[0][1]).toBe("A local\n");
  });

  it("c: an active source-mode tab merges its buffer", async () => {
    // 이것을 실패시키는 것: 소스 버퍼 단계를 shared editor 뒤로("A old").
    shared.commands.setContent("<p>A old</p>");
    markContentLoaded("a");
    buffers.set("a", "A src\n");
    useEditorStore.setState({ activeTabId: "a", sourceModeTabs: ["a"] });
    await mount();
    externalChange(A, 2000);
    await pressMerge();

    expect(io.mergeTexts.mock.calls[0][1]).toBe("A src\n");
  });

  it("k: a tab still loading is not merged; it is opened instead", async () => {
    // 이것을 실패시키는 것: 로딩 단계를 텍스트 반환으로(`openFiles` 로 merge 한다).
    setTabLoading("a", true);
    await mount();
    externalChange(A, 2000);
    await pressMerge();

    expect(io.mergeTexts).not.toHaveBeenCalled();
    expect(useEditorStore.getState().activeTabId).toBe("a");
    expect(queueIds()).toEqual(["a"]);
  });
});

describe("§3.6 Apply writes the conflicted tab and adopts the result there", () => {
  it("b: the active tab is left alone; the background tab is clean and stale", async () => {
    // 이것을 실패시키는 것: 활성 탭에 `markDirty(false)` / 배경 adopt 에서 `markContentStale` 제거.
    await mount();
    externalChange(A, 2000);
    await pressMerge();
    await applyMerge("MERGED\n");

    expect(disk.get(A)).toBe("MERGED\n");
    expect(isDirty("b")).toBe(true);
    expect(sharedText()).toBe("B body\n");
    expect(isDirty("a")).toBe(false);
    expect(useFileStore.getState().openFiles.get(A)).toBe("MERGED\n");
    expect(useEditorStore.getState().staleContentTabs).toContain("a");
    expect(queueIds()).toEqual([]);
    expect(screen.queryByTestId("merge-view")).toBeNull();
  });

  it("d: a disk that changed since Merge is not overwritten", async () => {
    // 이것을 실패시키는 것: Apply 의 사전 디스크 확인 제거.
    await mount();
    externalChange(A, 2000);
    await pressMerge();
    disk.set(A, "EXT2\n");
    await applyMerge("MERGED\n");

    expect(io.writeFile).not.toHaveBeenCalled();
    expect(queueIds()).toEqual(["a"]);
    await expectConflictFor("a.md");
    expect(useUIStore.getState().toast?.message).toBe(
      toastFor("conflict.diskChanged", "a.md"),
    );
  });

  it("d2: a tab text that changed since Merge is not overwritten", async () => {
    // 이것을 실패시키는 것: Apply 의 사전 local 확인 제거.
    await mount();
    externalChange(A, 2000);
    await pressMerge();
    cacheTab("a", "<p>A local 2</p>");
    await applyMerge("MERGED\n");

    expect(io.writeFile).not.toHaveBeenCalled();
    expect(queueIds()).toEqual(["a"]);
  });

  it("z: an active markdown tab with no live view to install into is not written", async () => {
    // 이것을 실패시키는 것: Apply 사전 확인의 `adoptable` 제거(디스크만 바뀌고 화면은 옛 문서).
    useEditorStore.setState({ activeTabId: "a" });
    await mount();
    externalChange(A, 2000);
    await pressMerge();
    await applyMerge("MERGED\n");

    expect(io.writeFile).not.toHaveBeenCalled();
    expect(queueIds()).toEqual(["a"]);
    expect(useUIStore.getState().toast?.message).toBe(
      toastFor("conflict.unavailable", "a.md"),
    );
  });
});

describe("§3.6 the merge view while Apply runs and after it fails", () => {
  it("is busy while the write runs", async () => {
    // 이것을 실패시키는 것: AppDialogs 가 MergeView 에 `busy` 를 넘기지 않음.
    const write = deferred<void>();
    io.writeFile.mockReturnValueOnce(write.promise);
    await mount();
    externalChange(A, 2000);
    await pressMerge();
    await waitFor(() => expect(merge.props).not.toBeNull());

    act(() => merge.props!.onApply("MERGED\n"));
    await settle();
    const busy = merge.props!.busy;
    write.resolve();
    await settle();

    expect(busy).toBe(true);
  });

  it("stays open after a failed write so Apply can be tried again", async () => {
    // 이것을 실패시키는 것: 실패하면 언제나 merge view 를 닫음.
    io.writeFile.mockRejectedValueOnce(new Error("EACCES"));
    await mount();
    externalChange(A, 2000);
    await pressMerge();
    await applyMerge("MERGED\n");

    expect(screen.queryByTestId("merge-view")).not.toBeNull();
    expect(merge.props!.busy).toBe(false);
    expect(queueIds()).toEqual(["a"]);
    expect(useUIStore.getState().toast?.message).toBe(
      toastFor("conflict.writeFailed", "a.md"),
    );
  });
});

describe("§3.6 an action that throws does not leave the buttons disabled", () => {
  it("a Merge that throws gives the modal its buttons back, the conflict queued", async () => {
    // `mergeTexts` 가 segments 없이 돌아오면 변환이 try 밖에서 던진다.
    // 이것을 실패시키는 것: `pending` 해제를 성공 콜백 안에만 둠(`finally` 제거 — 던지면 남는다).
    io.mergeTexts.mockResolvedValueOnce({});
    await mount();
    externalChange(A, 2000);
    await pressMerge();

    const dialog = await expectConflictFor("a.md");
    const button = within(dialog).getByRole("button", { name: "Merge" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(queueIds()).toEqual(["a"]);
  });

  it("an Apply that throws leaves the merge view usable", async () => {
    // 이것을 실패시키는 것: `mergeBusy` 해제를 성공 콜백 안에만 둠(`finally` 제거 — Apply·Cancel 이
    // 영원히 비활성인 전체 화면이 된다).
    await mount();
    externalChange(A, 2000);
    await pressMerge();
    await waitFor(() => expect(merge.props).not.toBeNull());
    const access = useEditorStore.getState().documentSurfaceAccess!;
    useEditorStore.setState({
      documentSurfaceAccess: {
        ...access,
        keepaliveEditor: () => {
          throw new Error("surface gone");
        },
      },
    });

    await applyMerge("MERGED\n");

    expect(merge.props!.busy).toBe(false);
    expect(queueIds()).toEqual(["a"]);
  });
});

describe("§3.6 the conflict outlives everything but a success", () => {
  it("e: Cancel keeps the conflict", async () => {
    // 이것을 실패시키는 것: 취소에서 resolve(또는 wrapper 가 동작 전에 resolve).
    await mount();
    externalChange(A, 2000);
    await pressMerge();
    cancelMerge();

    expect(io.writeFile).not.toHaveBeenCalled();
    await expectConflictFor("a.md");
  });

  it("f: a second conflict waits behind the first instead of replacing it", async () => {
    // 이것을 실패시키는 것: 큐를 한 칸으로(둘째 이벤트가 첫째를 덮는다).
    await mount();
    externalChange(A, 2000);
    externalChange(C, 2001);
    await pressMerge();
    await applyMerge("MERGED\n");

    await expectConflictFor("c.md");
  });

  it("f2: a conflict that arrives while a merge is open does not cover it", async () => {
    // 이것을 실패시키는 것: wrapper 가 `suspended` 를 무시(새 모달이 merge view 위에 뜬다).
    await mount();
    externalChange(A, 2000);
    await pressMerge();
    await screen.findByTestId("merge-view");

    externalChange(C, 2001);

    expect(conflictDialog()).toBeNull();
    expect(queueIds()).toEqual(["a", "c"]);
  });

  it("f3: cancelling that merge brings the first conflict back, not the second", async () => {
    // 이것을 실패시키는 것: 취소에서 resolve(머리가 c 가 된다).
    await mount();
    externalChange(A, 2000);
    await pressMerge();
    externalChange(C, 2001);
    cancelMerge();

    await expectConflictFor("a.md");
  });

  it("g: the modal's buttons are disabled while an action runs", async () => {
    // 이것을 실패시키는 것: wrapper 가 `pending` 을 무시.
    const read = deferred<string>();
    io.readFile.mockReturnValueOnce(read.promise);
    await mount();
    externalChange(A, 2000);
    const dialog = await expectConflictFor("a.md");
    click(dialog, "Merge");

    const disabled = [
      "Reload External Changes",
      "Keep Local Edits",
      "Merge",
    ].map(
      (name) =>
        (within(dialog).getByRole("button", { name }) as HTMLButtonElement)
          .disabled,
    );
    // 단언 전에 풀어 둔다 — 실패해도 토큰이 다음 테스트로 새지 않게.
    read.resolve("EXT1\n");
    await settle();

    expect(disabled).toEqual([true, true, true]);
  });

  it("h: a tab closed while Merge reads drops its conflict and opens nothing", async () => {
    // 이것을 실패시키는 것: `liveness` 의 탭 존재 확인 제거.
    const read = deferred<string>();
    io.readFile.mockReturnValueOnce(read.promise);
    await mount();
    externalChange(A, 2000);
    click(await expectConflictFor("a.md"), "Merge");
    // 탭의 텍스트는 이미 읽었고 디스크 읽기가 도는 중이다.
    await waitFor(() => expect(io.readFile).toHaveBeenCalledWith(A));

    act(() => useEditorStore.getState().closeTab("a"));
    read.resolve("EXT1\n");
    await settle();

    expect(screen.queryByTestId("merge-view")).toBeNull();
    expect(queueIds()).toEqual([]);
  });

  it("i: a failed merge leaves the buttons usable and the conflict queued", async () => {
    // 이것을 실패시키는 것: `finally` 의 `endOp` 제거(다음 동작이 영원히 busy).
    io.mergeTexts.mockRejectedValueOnce(new Error("merge failed"));
    await mount();
    externalChange(A, 2000);
    await pressMerge();

    const dialog = await expectConflictFor("a.md");
    const button = within(dialog).getByRole("button", { name: "Merge" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    click(dialog, "Merge");
    await settle();
    expect(io.mergeTexts).toHaveBeenCalledTimes(2);
  });
});

describe("§3.6 Keep Local saves the conflicted tab and reports what happened", () => {
  it("m: the background tab is written and marked saved; the active tab is not", async () => {
    // 이것을 실패시키는 것: 활성 탭일 때만 저장(오늘의 `handleSave` 경로).
    await mount();
    externalChange(A, 2000);
    click(await expectConflictFor("a.md"), "Keep Local Edits");
    await settle();

    expect(io.writeFile).toHaveBeenCalledWith(A, "A local\n");
    expect(isDirty("a")).toBe(false);
    expect(isDirty("b")).toBe(true);
    expect(queueIds()).toEqual([]);
    expect(useFileStore.getState().getFileMtime(A)).toEqual({
      canReloadMtime: 0,
      lastSaveMtime: NOW,
    });
  });

  it("n: a failed write keeps the conflict, the dirty flag and the guard", async () => {
    // 이것을 실패시키는 것: 쓰기 전에 가드를 푼다(오늘의 keep-local 순서).
    io.writeFile.mockRejectedValueOnce(new Error("EACCES"));
    await mount();
    externalChange(A, 2000);
    click(await expectConflictFor("a.md"), "Keep Local Edits");
    await settle();

    expect(queueIds()).toEqual(["a"]);
    expect(isDirty("a")).toBe(true);
    expect(shouldDeferSave(useFileStore.getState().getFileMtime(A))).toBe(true);
    expect(useUIStore.getState().toast?.message).toBe(
      toastFor("conflict.writeFailed", "a.md"),
    );
  });

  it("o: a failed write keeps a source edit marked unsaved", async () => {
    // isDirty 는 false, sourceEdited 만 선 탭. 이것을 실패시키는 것: 성공을 `!isDirty` 로 판정.
    buffers.set("a", "A src\n");
    useEditorStore.setState({
      activeTabId: "a",
      sourceEditedTabs: ["a"],
      sourceModeTabs: ["a"],
      tabs: [fileTab("a", A, false), fileTab("b", B), fileTab("c", C)],
    });
    io.writeFile.mockRejectedValueOnce(new Error("EACCES"));
    await mount();
    externalChange(A, 2000);
    click(await expectConflictFor("a.md"), "Keep Local Edits");
    await settle();

    expect(useEditorStore.getState().sourceEditedTabs).toEqual(["a"]);
    expect(queueIds()).toEqual(["a"]);
  });

  it("p: a source-mode tab with no buffer is not written as empty", async () => {
    // 이것을 실패시키는 것: 버퍼 없음을 `getSourceBuffer` 의 "" 로 읽음.
    useEditorStore.setState({ sourceModeTabs: ["a"] });
    await mount();
    externalChange(A, 2000);
    click(await expectConflictFor("a.md"), "Keep Local Edits");
    await settle();

    expect(io.writeFile).not.toHaveBeenCalled();
    expect(queueIds()).toEqual(["a"]);
    expect(useEditorStore.getState().activeTabId).toBe("a");
  });

  it("q: text typed while the write runs keeps the tab unsaved", async () => {
    // 이것을 실패시키는 것: adopt 를 무조건 clean 으로.
    const write = deferred<void>();
    io.writeFile.mockImplementationOnce(
      async (path: string, content: string) => {
        await write.promise;
        disk.set(path, content);
      },
    );
    await mount();
    externalChange(A, 2000);
    click(await expectConflictFor("a.md"), "Keep Local Edits");
    await settle();
    cacheTab("a", "<p>A local 2</p>");
    write.resolve();
    await settle();

    expect(isDirty("a")).toBe(true);
    expect(useFileStore.getState().openFiles.get(A)).toBe("A local\n");
    expect(queueIds()).toEqual([]);
  });

  it("t: a renamed tab's conflict is shown and saved under the new name", async () => {
    // 이것을 실패시키는 것: 경로로 식별(옛 이름의 모달, 옛 경로에 쓰기) / `fileMtimes` 재키잉 제거.
    await mount();
    externalChange(A, 2000);
    await expectConflictFor("a.md");

    act(() => {
      useFileStore.getState().renameFileEntry(A, A2, "a2.md");
      useEditorStore.getState().renameTab(A, A2, "a2.md");
    });
    expect(shouldDeferSave(useFileStore.getState().getFileMtime(A2))).toBe(
      true,
    );
    click(await expectConflictFor("a2.md"), "Keep Local Edits");
    await settle();

    expect(io.writeFile).toHaveBeenCalledWith(A2, "A local\n");
    expect(io.writeFile).not.toHaveBeenCalledWith(A, expect.anything());
  });
});

describe("§3.6 Reload discards only the conflicted tab's work, after the read", () => {
  it("r: the conflict and the flags stay until the read lands; then the tab takes the disk", async () => {
    // 이것을 실패시키는 것: flag 해제·resolve 를 읽기 await 앞으로.
    const read = deferred<string>();
    await mount();
    externalChange(A, 2000);
    io.readFile.mockReturnValueOnce(read.promise);
    click(await expectConflictFor("a.md"), "Reload External Changes");
    await settle();

    expect(queueIds()).toEqual(["a"]);
    expect(isDirty("a")).toBe(true);

    read.resolve("EXT1\n");
    await settle();

    expect(queueIds()).toEqual([]);
    expect(isDirty("a")).toBe(false);
    expect(useFileStore.getState().openFiles.get(A)).toBe("EXT1\n");
    expect(useFileStore.getState().getFileMtime(A)).toEqual({
      canReloadMtime: 0,
      lastSaveMtime: NOW,
    });
    expect(useUIStore.getState().toast?.message).toBe(
      "Reloaded external changes: a.md",
    );
  });

  it("r2: a tab reopened on the path while the read runs keeps its work", async () => {
    // 이것을 실패시키는 것: 반영 전 확인을 경로만으로(탭 id 생략) — 경로 단위 반영이 새 탭을 덮는다.
    const read = deferred<string>();
    await mount();
    externalChange(A, 2000);
    io.readFile.mockReturnValueOnce(read.promise);
    click(await expectConflictFor("a.md"), "Reload External Changes");
    await settle();

    act(() => {
      useEditorStore.getState().closeTab("a");
      useEditorStore.getState().openTab(fileTab("a-new", A, true));
    });
    read.resolve("EXT1\n");
    await settle();

    expect(isDirty("a-new")).toBe(true);
    expect(useFileStore.getState().openFiles.get(A)).toBe("A local\n");
    expect(useEditorStore.getState().staleContentTabs).not.toContain("a-new");
    expect(useUIStore.getState().toast).toBeNull();
  });

  it("r3: two tabs on one path are refused until the other one is closed", async () => {
    // 이것을 실패시키는 것: 같은 경로 탭 거부 제거(경로 단위 반영이 다른 탭의 버퍼를 지운다).
    buffers.set("a", "A src\n");
    buffers.set("a-dup", "A dup src\n");
    useEditorStore.setState({
      sourceModeTabs: ["a", "a-dup"],
      tabs: [fileTab("a", A), fileTab("a-dup", A), fileTab("b", B)],
    });
    await mount();
    externalChange(A, 2000);
    click(await expectConflictFor("a.md"), "Reload External Changes");
    await settle();

    expect(io.readFile).not.toHaveBeenCalled();
    expect([isDirty("a"), isDirty("a-dup")]).toEqual([true, true]);
    expect([buffers.get("a"), buffers.get("a-dup")]).toEqual([
      "A src\n",
      "A dup src\n",
    ]);
    expect(useUIStore.getState().toast?.message).toBe(
      toastFor("conflict.ambiguous", "a.md"),
    );

    act(() => useEditorStore.getState().closeTab("a-dup"));
    click(await expectConflictFor("a.md"), "Reload External Changes");
    await settle();
    expect(queueIds()).toEqual([]);
    expect(buffers.get("a")).toBe("EXT1\n");
  });

  it("r4: a tab that starts loading while the read runs is left as it is", async () => {
    // 이것을 실패시키는 것: 반영 전 `adoptable` 확인 제거.
    const read = deferred<string>();
    await mount();
    externalChange(A, 2000);
    io.readFile.mockReturnValueOnce(read.promise);
    click(await expectConflictFor("a.md"), "Reload External Changes");
    await settle();

    setTabLoading("a", true);
    read.resolve("EXT1\n");
    await settle();

    expect(isDirty("a")).toBe(true);
    expect(useFileStore.getState().openFiles.get(A)).toBe("A local\n");
    expect(queueIds()).toEqual(["a"]);
    expect(useUIStore.getState().toast?.message).toBe(
      toastFor("conflict.unavailable", "a.md"),
    );
  });

  it("r5: a binary viewer is not read; its sentinel stays and the conflict is resolved", async () => {
    // 이것을 실패시키는 것: binary 갈래 제거(텍스트로 읽어 캐시·버퍼에 넣는다).
    const PDF = "/v/doc.pdf";
    useFileStore.getState().setFileContent(PDF, "");
    useEditorStore.setState({
      tabs: [fileTab("p", PDF), fileTab("b", B)],
    });
    useUIStore.getState().enqueueConflict({
      base: "",
      externalMtime: 2000,
      filePath: PDF,
      tabId: "p",
    });
    disk.set(PDF, "%PDF binary");
    const setSourceBuffer = vi.spyOn(
      useEditorStore.getState().sourceBufferAccess!,
      "setSourceBuffer",
    );
    await mount();
    click(await expectConflictFor("doc.pdf"), "Reload External Changes");
    await settle();

    expect(io.readFile).not.toHaveBeenCalled();
    expect(useFileStore.getState().openFiles.get(PDF)).toBe("");
    expect(setSourceBuffer).not.toHaveBeenCalled();
    expect(queueIds()).toEqual([]);
    expect(useFileStore.getState().getFileMtime(PDF)?.lastSaveMtime).toBe(NOW);
  });

  it("r6: a second tab opened on the path while the read runs makes it refuse", async () => {
    // 탭의 텍스트를 읽을 수 없는 상태(문서 표면 미등록)라 local 비교가 건너뛰어지는 경우다 —
    // 그때도 같은 경로 탭 확인이 막아야 한다.
    // 이것을 실패시키는 것: 읽은 뒤의 같은 경로 탭 확인 제거(경로 단위 `openFiles` 가 새 탭의
    // 내용을 바꾼다).
    useEditorStore.setState({ documentSurfaceAccess: null });
    const read = deferred<string>();
    await mount();
    externalChange(A, 2000);
    io.readFile.mockReturnValueOnce(read.promise);
    click(await expectConflictFor("a.md"), "Reload External Changes");
    await settle();

    // `openTab` 은 같은 경로를 이미 연 탭으로 돌려보낸다 — 그 관문을 지난 상태(경로 변경 뒤)를
    // 직접 만든다.
    act(() =>
      useEditorStore.setState((st) => ({
        tabs: [...st.tabs, fileTab("a-dup", A, true)],
      })),
    );
    read.resolve("EXT1\n");
    await settle();

    expect(useFileStore.getState().openFiles.get(A)).toBe("A local\n");
    expect(queueIds()).toEqual(["a"]);
    expect(useUIStore.getState().toast?.message).toBe(
      toastFor("conflict.ambiguous", "a.md"),
    );
  });

  it("r7: text typed after the click is not covered by the consent", async () => {
    // 이것을 실패시키는 것: 반영 전 local 비교 제거(동의 뒤에 친 글자까지 버린다).
    const read = deferred<string>();
    await mount();
    externalChange(A, 2000);
    io.readFile.mockReturnValueOnce(read.promise);
    click(await expectConflictFor("a.md"), "Reload External Changes");
    await settle();

    cacheTab("a", "<p>A local, typed after Reload</p>");
    read.resolve("EXT1\n");
    await settle();

    expect(isDirty("a")).toBe(true);
    expect(useFileStore.getState().openFiles.get(A)).toBe("A local\n");
    expect(queueIds()).toEqual(["a"]);
    expect(useUIStore.getState().toast?.message).toBe(
      toastFor("conflict.localChanged", "a.md"),
    );
  });

  it("s: a failed read keeps the conflict and the flags", async () => {
    // 이것을 실패시키는 것: resolve 를 읽기 await 앞으로.
    await mount();
    externalChange(A, 2000);
    io.readFile.mockRejectedValueOnce(new Error("EIO"));
    click(await expectConflictFor("a.md"), "Reload External Changes");
    await settle();

    expect(queueIds()).toEqual(["a"]);
    expect(isDirty("a")).toBe(true);
    expect(useUIStore.getState().toast?.message).toBe(
      toastFor("conflict.readFailed", "a.md"),
    );
  });
});

describe("§3.6 conflicts follow their tabs", () => {
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

    expect(queueIds()).toEqual(["a-dup"]);
    expect(shouldDeferSave(useFileStore.getState().getFileMtime(A))).toBe(true);
  });
});
