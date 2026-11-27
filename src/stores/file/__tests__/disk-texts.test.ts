// §3.6 디스크 글 기록(`diskTexts`) — 그 파일을 보이는 탭의 글이 이어받은 디스크 글. 충돌 모달의 병합이
// 이것을 base 로 쓴다. 탭이 받아들인 디스크 글만 들어가야 한다: 저장 안 한 편집이 섞이거나, 탭이 받지 않은
// 디스크 쓰기가 들어가면 병합이 그 차이를 묻지 않고 한쪽으로 정한다. 기록을 놓친 쓰기는 기록을 오래되게
// 할 뿐이다.
import type { TaskEntry } from "../../../ipc/types";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onDisk = vi.hoisted(() => new Map<string, string>());
vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  readFile: (path: string) => Promise.resolve(onDisk.get(path) ?? ""),
}));

import { triggerAutoReload } from "../../../hooks/use-file-operations";
import {
  syncCleanSurfacesAfterReferrerRewrite,
  syncOpenSurfacesAfterDiskWrite,
  syncOpenSurfacesAfterFileRewrite,
} from "../../../utils/tasks/sync-open-surfaces";
import { startClosedTabRelease } from "../../editor/closed-tab-release";
import { useEditorStore } from "../../editor/editor";
import { useFileStore } from "../file";

const PATH = "/v/note.md";
const DISK = "# NOTE\n\n- [ ] task\n";

const tab = (id: string, filePath: string, isDirty = false) => ({
  contextId: "c",
  filePath,
  id,
  isDirty,
  isPinned: false,
  title: id,
});

const recorded = (path = PATH) => useFileStore.getState().diskTexts.get(path);

let stop: () => void = () => undefined;

beforeEach(() => {
  useFileStore.setState({
    diskTexts: new Map(),
    fileMtimes: new Map(),
    fileTree: [],
    openFiles: new Map(),
  });
  useEditorStore.setState({ activeTabId: null, tabs: [] });
});

afterEach(() => {
  stop();
  stop = () => undefined;
});

describe("§3.6 the disk text of a file a tab shows", () => {
  // What fails this: not recording in `noteFilesShown`. Every opener puts the text it just read into
  // `openFiles` before the tab appears; that is the text on disk.
  it("is what the opener put in openFiles when the tab appeared", () => {
    stop = startClosedTabRelease();
    useFileStore.getState().setFileContent(PATH, DISK);
    useEditorStore.getState().openTab(tab("t1", PATH));

    expect(recorded()).toBe(DISK);
  });

  it("is not recorded for a binary file, whose openFiles text is a placeholder", () => {
    stop = startClosedTabRelease();
    useFileStore.getState().setFileContent("/v/scan.pdf", "");
    useEditorStore.getState().openTab(tab("t1", "/v/scan.pdf"));

    expect(recorded("/v/scan.pdf")).toBeUndefined();
  });

  it("is not recorded for a tab whose opener fills openFiles only afterwards", () => {
    stop = startClosedTabRelease();
    useEditorStore.getState().openTab(tab("t1", PATH));
    useFileStore.getState().setFileContent(PATH, DISK);

    expect(recorded()).toBeUndefined();
  });

  // What fails this: dropping the third argument of `updateLastSaveMtime` from the record.
  it("is what a save wrote, and a call that does not know the text leaves it", () => {
    const store = useFileStore.getState();
    store.updateLastSaveMtime(PATH, 1, DISK);
    expect(recorded()).toBe(DISK);

    store.updateLastSaveMtime(PATH, 2, null);
    expect(recorded()).toBe(DISK);
  });

  it("does not change the state for the same text", () => {
    useFileStore.getState().noteDiskText(PATH, DISK);
    const before = useFileStore.getState();
    useFileStore.getState().noteDiskText(PATH, DISK);
    expect(useFileStore.getState()).toBe(before);
  });

  // What fails this: `setFileContent` writing the record as well. The left tab's unsaved text and the
  // in-app writes into a document go to `openFiles` and must not reach the record.
  it("does not follow openFiles", () => {
    useFileStore.getState().noteDiskText(PATH, DISK);
    useFileStore.getState().setFileContent(PATH, "# NOTE edited\n");

    expect(recorded()).toBe(DISK);
  });

  it("is released, renamed and removed with openFiles", () => {
    const store = useFileStore.getState();
    store.noteDiskText(PATH, DISK);
    store.noteDiskText("/v/dir/a.md", "a\n");

    useFileStore
      .getState()
      .renameFileEntry(PATH, "/v/renamed.md", "renamed.md");
    expect(recorded()).toBeUndefined();
    expect(recorded("/v/renamed.md")).toBe(DISK);

    useFileStore.getState().releaseFileContents(["/v/renamed.md"]);
    expect(recorded("/v/renamed.md")).toBeUndefined();

    useFileStore.getState().removeFileEntry("/v/dir");
    expect(recorded("/v/dir/a.md")).toBeUndefined();

    useFileStore.getState().noteDiskText(PATH, DISK);
    useFileStore.getState().removeFileContent(PATH);
    expect(recorded()).toBeUndefined();
  });
});

describe("§3.6 the disk text after an in-app disk write", () => {
  const task = (raw: string, line: number): TaskEntry =>
    ({ line, path: PATH, raw }) as TaskEntry;

  // The task panel's disk write changed that line on disk; the record takes it when it still holds
  // the line the panel saw, and is left older otherwise.
  it("takes a task line written on disk when it still holds that line", () => {
    useEditorStore.setState({ tabs: [tab("t1", PATH)] });
    useFileStore.getState().noteDiskText(PATH, DISK);

    syncOpenSurfacesAfterDiskWrite(task("- [ ] task", 2), "- [x] task", null);
    expect(recorded()).toBe("# NOTE\n\n- [x] task\n");

    syncOpenSurfacesAfterDiskWrite(task("- [ ] other", 2), "- [x] other", null);
    expect(recorded()).toBe("# NOTE\n\n- [x] task\n");
  });

  it("is the text a rewrite put on disk, for a file a tab shows", () => {
    useEditorStore.setState({ tabs: [tab("t1", PATH)] });
    syncOpenSurfacesAfterFileRewrite(PATH, "# rewritten\n", null);
    expect(recorded()).toBe("# rewritten\n");

    syncOpenSurfacesAfterFileRewrite("/v/closed.md", "# closed\n", null);
    expect(recorded("/v/closed.md")).toBeUndefined();
  });
});

describe("§3.6 a disk write the tab does not take", () => {
  const task = (raw: string, line: number): TaskEntry =>
    ({ line, path: PATH, raw }) as TaskEntry;

  // What fails this: recording a disk write that a dirty tab's document did not take. The tab's text
  // does not descend from it, and a merge against it reads the tab as taking the write back.
  it("is not recorded while the tab is dirty — a task line or a rewrite", () => {
    useEditorStore.setState({ tabs: [tab("t1", PATH, true)] });
    useFileStore.getState().noteDiskText(PATH, DISK);

    syncOpenSurfacesAfterDiskWrite(task("- [ ] task", 2), "- [x] task", null);
    syncOpenSurfacesAfterFileRewrite(PATH, "# rewritten\n", null);

    expect(recorded()).toBe(DISK);
  });

  it("is recorded for clean tabs a rename rewrote", () => {
    useEditorStore.setState({ tabs: [tab("t1", PATH)] });
    syncCleanSurfacesAfterReferrerRewrite(PATH, "# [[renamed]]\n");

    expect(recorded()).toBe("# [[renamed]]\n");
  });

  // What fails this: recording a reload that left a dirty background tab as it was. With the user's
  // consent (`force`) every tab takes it, and it is recorded.
  it("is a reload only when every tab showing the file takes it", async () => {
    onDisk.set(PATH, "# reloaded\n");
    useFileStore.getState().setFileContent(PATH, DISK);
    useFileStore.getState().noteDiskText(PATH, DISK);
    useEditorStore.setState({
      activeTabId: "other",
      tabs: [tab("t1", PATH, true)],
    });

    await triggerAutoReload(PATH, 10);
    expect(recorded()).toBe(DISK);

    await triggerAutoReload(PATH, 20, { force: true });
    expect(recorded()).toBe("# reloaded\n");
  });

  // A diverged source buffer kept by the reload (`kept`) does not take the text either.
  it("is not a reload that kept a diverged source buffer", async () => {
    const CODE = "/v/notes.txt";
    onDisk.set(CODE, "reloaded\n");
    useFileStore.getState().setFileContent(CODE, "seen\n");
    useFileStore.getState().noteDiskText(CODE, "seen\n");
    useEditorStore.setState({
      activeTabId: "t1",
      sourceBufferAccess: {
        getSourceBuffer: () => "typed\n",
        setSourceBuffer: () => undefined,
      },
      tabs: [tab("t1", CODE)],
    });

    await triggerAutoReload(CODE, 10);

    expect(recorded(CODE)).toBe("seen\n");
  });
});
