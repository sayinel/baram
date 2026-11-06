// §89 A file window keeps its unsaved state where a tab does, so the mark comes down when
// auto-save writes, and it saves what it shows in source mode.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// What is on disk, which `writeFile` changes, and what holds a read back while a test acts.
const disk = vi.hoisted(() => ({
  gate: Promise.resolve(),
  text: "on disk\n",
}));
const writeFile = vi.hoisted(() =>
  vi.fn(async (_path: string, content: string) => {
    disk.text = content;
  }),
);
const guard = vi.hoisted(() => vi.fn());
const menu = vi.hoisted(() => vi.fn());
const mergeTexts = vi.hoisted(() => vi.fn(async () => ({ segments: [] })));
const parse = vi.hoisted(() => ({ fails: false }));

vi.mock("../../../pipeline/md-to-pm", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../pipeline/md-to-pm")>();
  return {
    ...actual,
    markdownToProsemirror: (
      ...args: Parameters<typeof actual.markdownToProsemirror>
    ) => {
      if (parse.fails) throw new Error("Maximum call stack size exceeded");
      return actual.markdownToProsemirror(...args);
    },
  };
});

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  readFile: vi.fn(async () => {
    await disk.gate;
    return disk.text;
  }),
  updateFileIndex: vi.fn(async () => undefined),
  watchDir: vi.fn(async () => undefined),
  writeFile,
}));

vi.mock("../../../hooks/use-file-window-guard", () => ({
  useFileWindowGuard: guard,
}));

vi.mock("../../../hooks/use-file-window-menu", () => ({
  useFileWindowMenu: menu,
}));

vi.mock("../../../ipc/snapshot", () => ({ mergeTexts }));

vi.mock("../../editor/UnsavedChangesModal", () => ({
  UnsavedChangesModal: ({ handleSave }: { handleSave: () => void }) => (
    <button onClick={handleSave} type="button">
      modal save
    </button>
  ),
}));

vi.mock("../../editor/MergeView", () => ({
  MergeView: ({ onApply }: { onApply: (merged: string) => void }) => (
    <button onClick={() => onApply("merged\n")} type="button">
      apply merge
    </button>
  ),
}));

vi.mock("../../editor/SourceCodeEditor", () => ({
  SourceCodeEditor: ({
    content,
    onChange,
  }: {
    content: string;
    onChange: (next: string) => void;
  }) => (
    <textarea
      aria-label="source"
      onChange={(e) => onChange(e.target.value)}
      value={content}
    />
  ),
}));

import { listen } from "@tauri-apps/api/event";

import type { Editor } from "@tiptap/core";

import { useContextStore } from "../../../stores/context/context";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { serializeLiveDoc } from "../../../utils/editor/serialize-live-doc";
import { FileEditorLayout } from "../FileEditorLayout";

const PATH = "/v/note.md";

function liveEditor(): Editor {
  return (document.querySelector(".tiptap") as unknown as { editor: Editor })
    .editor;
}

function shown(): string {
  return document.querySelector(".tiptap")?.textContent ?? "";
}

/** Some other program writes the file, and the watcher says so. */
async function changeOnDisk(text: string, mtime = Date.now()) {
  disk.text = text;
  const fileChanged = () =>
    vi
      .mocked(listen)
      .mock.calls.filter(([name]) => name === "file:changed")
      .at(-1)?.[1];
  await waitFor(() => expect(fileChanged()).toBeDefined());
  await act(async () => {
    await fileChanged()?.({
      event: "file:changed",
      id: 0,
      payload: { mtime, path: PATH },
    });
  });
}

async function open() {
  const view = render(<FileEditorLayout filePath={PATH} />);
  await waitFor(() => expect(shown()).toContain(disk.text.trim()));
  await waitFor(() => expect(useEditorStore.getState().tabs).toHaveLength(1));
  return view;
}

function pressSave() {
  fireEvent.keyDown(window, { key: "s", metaKey: true });
}

function settle(ms: number) {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function toggleSource() {
  fireEvent.keyDown(window, { key: "/", metaKey: true });
}

/** What the guard was last told about the window. */
function unsaved(): boolean {
  return guard.mock.calls.at(-1)?.[1] as boolean;
}

beforeEach(() => {
  writeFile.mockClear();
  guard.mockClear();
  menu.mockClear();
  mergeTexts.mockClear();
  vi.mocked(listen).mockClear();
  disk.gate = Promise.resolve();
  disk.text = "on disk\n";
  parse.fails = false;
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  useEditorStore.setState({
    activeTabId: null,
    mruOrder: [],
    sourceEditedTabs: [],
    tabs: [],
  });
  useSettingsStore.setState({ autoSave: false, autoSaveDelay: 500 });
  useContextStore.setState({
    contexts: [],
    ensureFileContext: vi.fn(async () => ({ contextType: "file" })),
  } as never);
});

describe("a file window's unsaved state", () => {
  // 이것을 실패시키는 것: 지역 상태가 update 를 그대로 받으면 불러오는 `setContent` 로 열자마자 dirty 다.
  it("is clean when the file has just opened", async () => {
    await open();

    expect(unsaved()).toBe(false);
    expect(screen.queryByLabelText("Unsaved changes")).toBeNull();
  });

  it("is unsaved once something is typed", async () => {
    await open();

    act(() => {
      liveEditor().commands.insertContent("typed ");
    });

    await waitFor(() => expect(unsaved()).toBe(true));
  });

  // 이것을 실패시키는 것: 표시가 지역 상태면 자동 저장이 쓴 뒤에도 내려가지 않아 창을 닫을 때마다 묻는다.
  it("comes down when auto-save has written", async () => {
    useSettingsStore.setState({ autoSave: true });
    await open();

    act(() => {
      liveEditor().commands.insertContent("typed ");
    });

    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce(), {
      timeout: 3000,
    });
    await waitFor(() => expect(unsaved()).toBe(false));
  });

  it("comes down when saved by hand", async () => {
    await open();
    act(() => {
      liveEditor().commands.insertContent("typed ");
    });

    pressSave();

    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    await waitFor(() => expect(unsaved()).toBe(false));
  });

  it("stays up when the save fails", async () => {
    writeFile.mockRejectedValueOnce(new Error("disk full"));
    await open();
    act(() => {
      liveEditor().commands.insertContent("typed ");
    });

    pressSave();

    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    await act(async () => {
      await Promise.resolve();
    });
    expect(unsaved()).toBe(true);
  });
});

describe("a file window's document", () => {
  // 이것을 실패시키는 것: 불러오기가 undo 단계가 되면 막 연 창의 Cmd+Z 가 문서를 비우고, 자동 저장이 파일을 비운다.
  it("cannot be undone back to empty once opened", async () => {
    await open();

    act(() => {
      liveEditor().commands.undo();
    });

    expect(shown()).toContain("on disk");
    expect(unsaved()).toBe(false);
  });

  // 이것을 실패시키는 것: `addToHistory: false` 로는 문서 전체를 바꾼 앞 단계가 매핑을 지나 undo 로 되살아나
  // 옛 글이 외부 변경을 덮는다.
  it.each([
    ["typing", () => liveEditor().commands.insertContent("typed ")],
    [
      "replacing the whole document",
      () => liveEditor().commands.setContent("<p>replaced</p>"),
    ],
  ])("cannot be undone back to before a reload, after %s", async (_n, edit) => {
    await open();
    act(() => {
      edit();
    });
    pressSave();
    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    await waitFor(() => expect(unsaved()).toBe(false));
    await changeOnDisk("external\n");
    await waitFor(() => expect(shown()).toContain("external"));

    act(() => {
      liveEditor().commands.undo();
    });

    expect(shown()).toContain("external");
    expect(unsaved()).toBe(false);
  });

  // 이것을 실패시키는 것: 불러오기 전의 Cmd+S 는 빈 문서를 파일에 쓴다.
  it("is not written, or shown as source, before it has loaded", async () => {
    let release = () => {};
    disk.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    render(<FileEditorLayout filePath={PATH} />);
    await settle(0);

    pressSave();
    toggleSource();
    await settle(0);
    expect(writeFile).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(shown()).toContain("on disk"));
    expect(screen.queryByLabelText("source")).toBeNull();
  });

  // 이것을 실패시키는 것: 새 id 를 그대로 쓰면, 스토어가 경로로 합쳐 옛 탭을 남겨 창이 없는 탭을 보고 clean 이라 답한다.
  it("after Retry remounts the window, follows the tab the store kept", async () => {
    const first = await open();
    const kept = useEditorStore.getState().tabs[0].id;
    act(() => {
      liveEditor().commands.insertContent("typed ");
    });
    await waitFor(() => expect(unsaved()).toBe(true));

    first.unmount();
    await settle(2);
    await open();

    await waitFor(() => expect(guard.mock.calls.at(-1)?.[0]).toBe(kept));
    // What is shown now is the file again, so the mark from before the error has gone.
    await waitFor(() => expect(unsaved()).toBe(false));

    act(() => {
      liveEditor().commands.insertContent("typed ");
    });
    await waitFor(() => expect(unsaved()).toBe(true));
  });

  // 이것을 실패시키는 것: 재마운트가 관문을 풀지 않으면, 배너는 사라졌는데 자동 저장이 조용히 멈춰 있다.
  it("after Retry remounts the window, is not held by a banner it has lost", async () => {
    const first = await open();
    act(() => {
      liveEditor().commands.insertContent("typed ");
    });
    await waitFor(() => expect(unsaved()).toBe(true));
    await changeOnDisk("external\n");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    first.unmount();
    useSettingsStore.setState({ autoSave: true, autoSaveDelay: 30 });
    await open();
    act(() => {
      liveEditor().commands.insertContent("more ");
    });

    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
  });

  // 이것을 실패시키는 것: 탭이 열린 뒤 설치에서 던지면 관문이 열려 있어, 오류 화면의 Cmd+S 가 빈 문서로 파일을 덮는다.
  it("is not written after it could not be parsed", async () => {
    parse.fails = true;
    render(<FileEditorLayout filePath={PATH} />);
    await screen.findByText("Maximum call stack size exceeded");

    pressSave();
    await settle(0);

    expect(writeFile).not.toHaveBeenCalled();
    expect(guard.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("answers a close with the modal, whose Save writes this window's text", async () => {
    await open();
    act(() => {
      liveEditor().commands.insertContent("typed ");
    });

    fireEvent.click(screen.getByRole("button", { name: "modal save" }));

    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    expect(writeFile.mock.calls[0][1]).toContain("typed");
  });

  // 이것을 실패시키는 것: 저장이 기준선을 올리지 않으면, 연 때의 글로 되돌린 문서가 변경으로 안 잡혀 디스크와 다른 채 clean 이다.
  it("counts text put back to how it opened, once another version was saved", async () => {
    await open();
    act(() => {
      liveEditor().commands.insertContent("typed ");
    });
    pressSave();
    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    await waitFor(() => expect(unsaved()).toBe(false));

    act(() => {
      liveEditor().commands.undo();
    });

    expect(shown()).not.toContain("typed");
    await waitFor(() => expect(unsaved()).toBe(true));
  });

  // 이것을 실패시키는 것: 쓰는 동안 친 글자까지 저장됐다고 표시를 내리면 그 글자는 조용히 사라질 수 있다.
  it("stays marked when something was typed during the write", async () => {
    let finish = () => {};
    writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await open();
    act(() => {
      liveEditor().commands.insertContent("first ");
    });

    pressSave();
    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    act(() => {
      liveEditor().commands.insertContent("second ");
    });
    await act(async () => {
      finish();
    });
    await settle(0);

    expect(unsaved()).toBe(true);
  });
});

describe("the native menu in a file window", () => {
  function given() {
    return menu.mock.calls.at(-1)?.[0] as {
      handleSave: () => Promise<void>;
      holdsDocument: boolean;
      toggleSource: () => void;
    };
  }

  it("switches source mode the way Cmd+/ does", async () => {
    await open();

    act(() => {
      given().toggleSource();
    });

    expect(await screen.findByLabelText("source")).toBeInTheDocument();
  });

  it("saves the way Cmd+S does", async () => {
    await open();
    act(() => {
      liveEditor().commands.insertContent("typed ");
    });

    await act(async () => {
      await given().handleSave();
    });

    expect(writeFile.mock.calls[0][1]).toContain("typed");
  });

  // 이것을 실패시키는 것: 이 창에 토스트 자리가 없으면 메뉴의 안내가 아무 데도 보이지 않는다.
  it("has somewhere to say what it cannot do", async () => {
    await open();

    act(() => {
      useUIStore.getState().showToast("not in this window");
    });

    expect(await screen.findByText("not in this window")).toBeInTheDocument();
    act(() => {
      useUIStore.setState({ toast: null });
    });
  });

  // 이것을 실패시키는 것: 소스 모드에서 서식을 걸면 보이지 않는 문서가 바뀌어, 돌아올 때 버퍼와 어긋난다.
  it("offers the document only while it is the one on screen", async () => {
    let release = () => {};
    disk.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    render(<FileEditorLayout filePath={PATH} />);
    await settle(0);
    expect(given().holdsDocument).toBe(false);

    release();
    await waitFor(() => expect(shown()).toContain("on disk"));
    await waitFor(() => expect(given().holdsDocument).toBe(true));

    toggleSource();
    await screen.findByLabelText("source");
    expect(given().holdsDocument).toBe(false);
  });
});

describe("a change on disk", () => {
  function pressButton(name: string) {
    fireEvent.click(screen.getByRole("button", { name }));
  }

  /** Auto-save comes on only here, so its timer cannot fire before the banner is up. */
  function typeWithAutoSaveOn() {
    act(() => {
      useSettingsStore.setState({ autoSave: true, autoSaveDelay: 30 });
    });
    act(() => {
      liveEditor().commands.insertContent("more ");
    });
  }

  function typeSomething() {
    act(() => {
      liveEditor().commands.insertContent("typed ");
    });
    return waitFor(() => expect(unsaved()).toBe(true));
  }

  // 이것을 실패시키는 것: `update` 를 내면 자동 저장이 편집으로 읽어 방금 읽은 글을 도로 쓴다.
  it("reloads a clean window without writing it back", async () => {
    useSettingsStore.setState({ autoSave: true, autoSaveDelay: 30 });
    await open();

    await changeOnDisk("external\n");
    await waitFor(() => expect(shown()).toContain("external"));
    await settle(100);

    expect(writeFile).not.toHaveBeenCalled();
    expect(unsaved()).toBe(false);
  });

  it("leaves the caret about where it was", async () => {
    disk.text = "some longer text on disk\n";
    await open();
    act(() => {
      liveEditor().commands.setTextSelection(6);
    });

    await changeOnDisk("some longer text out there\n");
    await waitFor(() => expect(shown()).toContain("out there"));

    expect(liveEditor().state.selection.anchor).toBe(6);
  });

  // 이것을 실패시키는 것: 불러온 글을 표시하지 않으면 다음 편집이 그 전 기준선과 비교된다.
  it("counts text put back to the version before the reload", async () => {
    await open();
    act(() => {
      liveEditor().commands.insertContent("typed ");
    });
    pressSave();
    await waitFor(() => expect(unsaved()).toBe(false));
    const saved = liveEditor().getJSON();

    await changeOnDisk("external\n");
    await waitFor(() => expect(shown()).toContain("external"));
    act(() => {
      liveEditor().commands.setContent(saved);
    });

    await waitFor(() => expect(unsaved()).toBe(true));
  });

  // 이것을 실패시키는 것: 도는 중인 타이머가 배너가 묻고 있는 외부 변경을 덮어쓴다.
  it("holds auto-save off until the banner is answered", async () => {
    await open();
    await typeSomething();
    await changeOnDisk("external\n");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    typeWithAutoSaveOn();
    await settle(100);

    expect(writeFile).not.toHaveBeenCalled();
    expect(disk.text).toBe("external\n");
  });

  // Nothing is in dispute when the file comes back to what this window knows.
  it("takes the banner down when the file comes back", async () => {
    await open();
    await typeSomething();
    await changeOnDisk("external\n");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await changeOnDisk("on disk\n");

    expect(screen.queryByRole("alert")).toBeNull();
  });

  // 이것을 실패시키는 것: 파일의 시각을 그대로 쓰면 마지막 저장보다 오래된 사본(`cp -p`)에 관문이 걸리지 않아 덮어쓴다.
  it("holds auto-save off for a copy older than the last save", async () => {
    await open();
    await typeSomething();
    pressSave();
    await waitFor(() => expect(unsaved()).toBe(false));
    await typeSomething();

    await changeOnDisk("kept its time\n", Date.now() - 60_000);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    typeWithAutoSaveOn();
    await settle(100);

    expect(disk.text).toBe("kept its time\n");
  });

  // 이것을 실패시키는 것: 쓴 글을 기억하지 않으면 저장 뒤 계속 칠 때 자기 저장의 메아리가 충돌 배너를 띄운다.
  it("does not take its own save coming back for a change", async () => {
    await open();
    await typeSomething();
    pressSave();
    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    await waitFor(() => expect(unsaved()).toBe(false));
    const saved = disk.text;
    await typeSomething();

    await changeOnDisk(saved);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Nothing is in dispute when the file now says what this window holds.
  it("does not ask about a write of what is already here", async () => {
    await open();
    await typeSomething();
    const held = serializeLiveDoc(liveEditor());

    await changeOnDisk(held);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  // 이것을 실패시키는 것: Cmd+S 가 쓴 시각을 남기지 않으면, 이미 덮어쓴 변경을 두고 자동 저장이 계속 멈춰 있다.
  it("lifts the hold when saved by hand", async () => {
    await open();
    await typeSomething();
    await changeOnDisk("external\n");
    pressSave();
    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    await waitFor(() => expect(unsaved()).toBe(false));

    typeWithAutoSaveOn();

    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(2));
  });

  it("lets auto-save go on after Keep", async () => {
    await open();
    await typeSomething();
    await changeOnDisk("external\n");

    pressButton("Keep Local");
    expect(screen.queryByRole("alert")).toBeNull();
    typeWithAutoSaveOn();

    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    expect(writeFile.mock.calls[0][1]).toContain("more");
  });

  it("shows the file and comes clean after Reload", async () => {
    await open();
    await typeSomething();
    await changeOnDisk("external\n");

    pressButton("Reload");

    await waitFor(() => expect(shown()).toContain("external"));
    await waitFor(() => expect(unsaved()).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Cmd+S has answered it: the file now says what this window holds.
  it("takes the banner down when saved by hand", async () => {
    await open();
    await typeSomething();
    await changeOnDisk("external\n");

    pressSave();

    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  // 이것을 실패시키는 것: 자동 저장이 쓴 글을 기억하지 않으면 3-way 병합의 base 가 연 때의 글로 남는다.
  it("merges against the text last written", async () => {
    useSettingsStore.setState({ autoSave: true, autoSaveDelay: 30 });
    await open();
    await typeSomething();
    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    await waitFor(() => expect(unsaved()).toBe(false));
    const written = writeFile.mock.calls[0][1];
    useSettingsStore.setState({ autoSave: false });
    await typeSomething();
    await changeOnDisk("external\n");

    pressButton("Merge");

    await waitFor(() => expect(mergeTexts).toHaveBeenCalledOnce());
    expect((mergeTexts.mock.calls[0] as unknown[])[0]).toBe(written);
  });

  it("installs an applied merge as the file", async () => {
    mergeTexts.mockResolvedValue({ segments: [] });
    await open();
    await typeSomething();
    await changeOnDisk("external\n");
    pressButton("Merge");
    const apply = await screen.findByRole("button", { name: "apply merge" });

    fireEvent.click(apply);

    await waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith(PATH, "merged\n"),
    );
    await waitFor(() => expect(shown()).toContain("merged"));
    await waitFor(() => expect(unsaved()).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("source mode in a file window", () => {
  async function typeInSource(text: string) {
    await open();
    toggleSource();
    const box = await screen.findByLabelText("source");
    fireEvent.change(box, { target: { value: text } });
  }

  // 이것을 실패시키는 것: 복귀 때 문서를 무조건 설치하면 WYSIWYG 의 저장 안 된 글이 clean 으로 표시된다.
  it("looking at the source keeps work from before it unsaved", async () => {
    await open();
    act(() => {
      liveEditor().commands.insertContent("typed ");
    });
    await waitFor(() => expect(unsaved()).toBe(true));

    toggleSource();
    await screen.findByLabelText("source");
    toggleSource();
    await waitFor(() => expect(shown()).toContain("typed"));

    await settle(0);
    expect(unsaved()).toBe(true);
  });

  // 이것을 실패시키는 것: 들어갈 때 "친 적 있음" 을 지우지 않으면 앞서 친 기록이 남아 저장된 글로 설치한다.
  it("a second look does not read the first visit's typing as saved", async () => {
    await typeInSource("typed in source\n");
    toggleSource();
    await waitFor(() => expect(shown()).toContain("typed in source"));
    await waitFor(() => expect(unsaved()).toBe(true));

    toggleSource();
    await screen.findByLabelText("source");
    toggleSource();
    await waitFor(() =>
      expect(document.querySelector(".tiptap")).not.toBeNull(),
    );

    await settle(0);
    expect(unsaved()).toBe(true);
  });

  // 이것을 실패시키는 것: 버퍼를 그대로 두면 돌아올 때 낡은 글을 "저장된 문서" 로 설치해 파일과 다른 채 clean 이다.
  it("Reload replaces what is in the buffer", async () => {
    await typeInSource("typed in source\n");
    await waitFor(() => expect(unsaved()).toBe(true));
    await changeOnDisk("external\n");

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() =>
      expect(screen.getByLabelText("source")).toHaveValue("external\n"),
    );
    await waitFor(() => expect(unsaved()).toBe(false));

    toggleSource();
    await waitFor(() => expect(shown()).toContain("external"));
    expect(unsaved()).toBe(false);
  });

  // 이것을 실패시키는 것: 소스 모드 전의 자동 저장 타이머가 옛 문서로 이 저장을 덮고, 표시는 clean 이다.
  it("a save there is not undone by a timer from before source mode", async () => {
    useSettingsStore.setState({ autoSave: true, autoSaveDelay: 500 });
    await open();
    act(() => {
      liveEditor().commands.insertContent("typed ");
    });
    toggleSource();
    fireEvent.change(await screen.findByLabelText("source"), {
      target: { value: "typed in source\n" },
    });
    pressSave();
    await waitFor(() => expect(disk.text).toBe("typed in source\n"));

    await settle(600);

    expect(disk.text).toBe("typed in source\n");
    expect(unsaved()).toBe(false);
  });

  // 이것을 실패시키는 것: 저장한 글이 문서에 들어가지 않으면 돌아와 Undo 로 되돌린 문서가 변경으로 안 잡혀 디스크와 다른 채 clean 이다.
  it("what is undone after coming back from a save there reads as a change or as the file", async () => {
    await open();
    act(() => {
      liveEditor().commands.insertContent("typed ");
    });
    toggleSource();
    await screen.findByLabelText("source");
    pressSave();
    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    toggleSource();
    await waitFor(() => expect(shown()).toContain("typed"));

    act(() => {
      liveEditor().commands.undo();
    });
    await settle(0);

    expect(shown()).toContain("typed");
    expect(unsaved()).toBe(false);
  });

  // 이것을 실패시키는 것: 문서를 읽으면 소스에서 친 글은 병합되지 않고 사라진다.
  it("Merge takes what is typed there", async () => {
    await typeInSource("typed in source\n");
    await waitFor(() => expect(unsaved()).toBe(true));
    await changeOnDisk("external\n");

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    await waitFor(() =>
      expect(mergeTexts).toHaveBeenCalledWith(
        "on disk\n",
        "typed in source\n",
        "external\n",
      ),
    );
  });

  // 이것을 실패시키는 것: 문서와만 비교하면 자기 저장의 메아리가 충돌 배너를 띄운다.
  it("does not take its own save coming back for a change", async () => {
    await typeInSource("first\n");
    pressSave();
    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    await waitFor(() => expect(unsaved()).toBe(false));
    fireEvent.change(screen.getByLabelText("source"), {
      target: { value: "first\nsecond\n" },
    });
    await waitFor(() => expect(unsaved()).toBe(true));

    await changeOnDisk("first\n");
    expect(screen.queryByRole("alert")).toBeNull();

    // The pair: anything else on disk is a change.
    await changeOnDisk("external\n");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("stays marked when something was typed during the write", async () => {
    let finish = () => {};
    writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await typeInSource("first\n");

    pressSave();
    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("source"), {
      target: { value: "first\nsecond\n" },
    });
    await act(async () => {
      finish();
    });
    await settle(0);

    expect(unsaved()).toBe(true);
  });

  it("counts what is typed there", async () => {
    await typeInSource("typed in source\n");

    await waitFor(() => expect(unsaved()).toBe(true));
  });

  // 이것을 실패시키는 것: Cmd+S 가 소스 모드에서도 문서를 직렬화하면 친 글 대신 옛 글을 쓰고 저장됐다고 한다.
  it("saves what is typed there, not the document behind it", async () => {
    await typeInSource("typed in source\n");

    pressSave();

    await waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith(PATH, "typed in source\n"),
    );
    await waitFor(() => expect(unsaved()).toBe(false));
  });

  // 이것을 실패시키는 것: 저장한 글을 다시 편집으로 넣으면 저장한 직후 탭이 다시 dirty 가 된다.
  it("coming back after saving shows that text and stays clean", async () => {
    await typeInSource("typed in source\n");
    pressSave();
    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());

    toggleSource();

    await waitFor(() =>
      expect(document.querySelector(".tiptap")?.textContent).toContain(
        "typed in source",
      ),
    );
    expect(unsaved()).toBe(false);
  });

  it("coming back without saving carries the text over as unsaved", async () => {
    await typeInSource("typed in source\n");

    toggleSource();

    await waitFor(() =>
      expect(document.querySelector(".tiptap")?.textContent).toContain(
        "typed in source",
      ),
    );
    await waitFor(() => expect(unsaved()).toBe(true));
    expect(useEditorStore.getState().sourceEditedTabs).toEqual([]);
  });

  // The pair: looking at the source changes nothing.
  it("looking at the source and coming back leaves it clean", async () => {
    await open();
    const before = liveEditor().state.doc;

    toggleSource();
    await screen.findByLabelText("source");
    toggleSource();

    await waitFor(() =>
      expect(document.querySelector(".tiptap")).not.toBeNull(),
    );
    expect(unsaved()).toBe(false);
    // Parsed back in, the text could come out different, and that would be an edit nobody made.
    expect(liveEditor().state.doc).toBe(before);
  });
});
