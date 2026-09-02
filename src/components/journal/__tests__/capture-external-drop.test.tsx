// §324-e Finder에서 끌어다 놓은 이미지 → 열려 있는 캡처 창.
//
// ‼️ 왜 붙여넣기 테스트(QuickCaptureDialog.test.tsx)가 이 결함을 못 잡았는가:
// 같은 상자에 같은 이미지를 넣는데 경로가 완전히 다르다.
//   ⌘V   → ProseMirror `handlePaste` → DropHandler
//   드랍 → OS 파일 드래그 → Tauri 네이티브가 가로챔(`isExternalFileDrag`)
//        → ProseMirror `handleDrop`은 즉시 빠져나감(drop-handler.ts)
//        → `use-external-drop.ts`가 처리 — 그 훅은 캡처 창의 존재를 몰랐다
// §324-e의 테스트가 전부 붙여넣기 쪽만 덮은 탓에, 드랍이 통째로 죽어 있는 동안
// 스위트는 초록이었다. 그래서 이 파일은 **훅을 통과하는** 경로만 본다: 네이티브
// 드래그 이벤트를 실제 핸들러에 먹이고, 디스크로 나가는 IPC 인수를 읽는다.
//
// jsdom이 못 하는 것과 이 파일이 하는 것:
//  - jsdom은 레이아웃을 하지 않아 모든 rect가 0이다. 그래서 존 판정에 쓰이는
//    세 요소의 `getBoundingClientRect`만 명시적으로 심어 좌표 판정을 진짜로
//    돌린다(그 외의 rect는 0으로 두어도 결론에 영향이 없다).
//  - 실제 Tauri 네이티브 드래그·OS 파일 픽커·화면에 그려진 강조는 사람만
//    확인할 수 있다. 여기서 확인하는 것은 "그 이벤트가 왔을 때 어디로 가는가"다.
import type { Editor as CoreEditor } from "@tiptap/core";

import { act, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createDirMock = vi.hoisted(() => vi.fn());
const importFileMock = vi.hoisted(() => vi.fn());
const listDirMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());
/** 훅이 등록한 Tauri 드래그 리스너 — 테스트가 직접 호출한다. */
const drag = vi.hoisted(() => ({
  handler: null as ((event: unknown) => void) | null,
}));

// 삽입이 성공하면 이미지 NodeView가 실제로 마운트되고 썸네일 경로
// (`utils/journal/photo-thumbnail.ts`)가 `convertFileSrc`를 부른다 —
// test-setup.ts의 공용 mock에는 그 export가 없어 unhandled rejection이 된다
// (테스트는 통과하면서 파일은 실패하는 그 종류). 여기서 채운다.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(async (command: string) =>
    command === "get_config" ? null : undefined,
  ),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (cb: (event: unknown) => void) => {
      drag.handler = cb;
      return Promise.resolve(() => {
        drag.handler = null;
      });
    },
  }),
}));

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  createDir: createDirMock,
  importFile: importFileMock,
  listDir: listDirMock,
  readFile: readFileMock,
}));

import { createBaramExtensions } from "../../../extensions";
import { useExternalDrop } from "../../../hooks/use-external-drop";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { QuickCaptureDialog } from "../QuickCaptureDialog";

const PHOTO = "/Users/x/Desktop/photo.png";

/** 메인 창에 열려 있는, 캡처와 아무 상관 없는 문서. 오염의 출처다. */
const UNRELATED_DOC = "/vault/notes/unrelated.md";
const UNRELATED_ASSETS = "/vault/notes/assets/photo.png";

const ZETTEL_ASSETS = "/vault/zettel/inbox/assets/photo.png";
const TASKS_ASSETS = "/vault/tasks-home/tasks/assets/photo.png";

/** 존 판정이 실제로 좌표를 보게 하는 최소 레이아웃. 서로 겹치지 않는다. */
const DIALOG_RECT = { bottom: 400, left: 300, right: 700, top: 100 };
const EDITOR_RECT = { bottom: 900, left: 260, right: 1200, top: 0 };
const TREE_RECT = { bottom: 900, left: 0, right: 259, top: 0 };

/** 다이얼로그와 메인 편집기가 **둘 다** 덮는 점 — 우선순위가 갈리는 자리. */
const INSIDE_BOTH = { x: 500, y: 250 };
/** 다이얼로그 밖, 메인 편집기 안. */
const EDITOR_ONLY = { x: 900, y: 600 };
/** 파일 트리 안. */
const TREE_ONLY = { x: 100, y: 500 };

const editors: CoreEditor[] = [];

/** 훅을 실제 컴포넌트 수명에 태운다 — App이 하는 것과 같은 호출. */
function DropHarness({ editor }: { editor: CoreEditor | null }) {
  useExternalDrop({ editor });
  return null;
}

async function fireNativeDrop(
  point: { x: number; y: number },
  paths: string[] = [PHOTO],
): Promise<void> {
  await act(async () => {
    drag.handler?.({
      payload: { type: "enter", paths, position: point },
    });
    drag.handler?.({
      payload: { type: "drop", paths, position: point },
    });
  });
}

async function fireNativeOver(point: { x: number; y: number }): Promise<void> {
  await act(async () => {
    drag.handler?.({
      payload: { type: "enter", paths: [PHOTO], position: point },
    });
    drag.handler?.({ payload: { type: "over", position: point } });
  });
}

function makeMainEditor(): CoreEditor {
  const editor = new Editor({
    content: "<p>main window document</p>",
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  return editor;
}

/**
 * 존 판정용 rect를 심는다. jsdom은 레이아웃을 하지 않아 기본값이 전부 0이고,
 * 그러면 `hitTestRect`가 어떤 좌표에도 참이 되지 않아(0..0 범위) 모든 단정이
 * 존 판정과 무관하게 통과한다 — 심지 않으면 이 파일 전체가 공허해진다.
 */
function stubRect(
  el: Element | null,
  r: { bottom: number; left: number; right: number; top: number },
): void {
  if (!el) throw new Error("stubRect: element not found");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    ...r,
    height: r.bottom - r.top,
    toJSON: () => ({}),
    width: r.right - r.left,
    x: r.left,
    y: r.top,
  } as DOMRect);
}

/** 메인 창의 문서 편집기 스크롤 영역과 파일 트리. React 밖에 둔다. */
function mountMainWindowSurfaces(): void {
  const scroll = document.createElement("div");
  scroll.className = "editor-area-scroll";
  scroll.setAttribute("data-editor-active", "");
  document.body.appendChild(scroll);
  stubRect(scroll, EDITOR_RECT);

  const tree = document.createElement("div");
  tree.className = "file-tree";
  document.body.appendChild(tree);
  stubRect(tree, TREE_RECT);
}

/** 캡처 창이 렌더된 뒤 그 다이얼로그에 rect를 심는다. */
function stubDialogRect(): void {
  stubRect(document.querySelector(".quick-capture-dialog"), DIALOG_RECT);
}

function useZettelSpace(): void {
  useSettingsStore.getState().setZettelkastenEnabled(true);
  useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
  useFileStore.getState().setRootPath("/vault");
}

const originalEditorState = useEditorStore.getState();
const originalSettingsState = useSettingsStore.getState();
const originalFileState = useFileStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  createDirMock.mockResolvedValue(undefined);
  importFileMock.mockResolvedValue(undefined);
  listDirMock.mockResolvedValue([]);
  readFileMock.mockResolvedValue("");
  useSettingsStore.setState({ locale: "en" });
  // 오염: 메인 창에 캡처와 무관한 문서가 열려 있다. 결함이 있던 코드는 여기서
  // 목적지를 유도했다.
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [{ id: "t1", filePath: UNRELATED_DOC }],
  } as never);
  mountMainWindowSurfaces();
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  drag.handler = null;
  document.body.innerHTML = "";
  useEditorStore.setState(originalEditorState, true);
  useSettingsStore.setState(originalSettingsState, true);
  useFileStore.setState(originalFileState, true);
  useUIStore.setState({
    quickCaptureOpen: false,
    quickCaptureTaskIntent: false,
  });
});

describe("§324-e 캡처 창 위로 끌어다 놓은 파일의 목적지", () => {
  it("캡처 목적지 아래로 저장한다 — 메인 창의 활성 탭 옆이 아니다", async () => {
    useZettelSpace();
    useUIStore.setState({ quickCaptureOpen: true });

    render(
      <>
        <DropHarness editor={makeMainEditor()} />
        <QuickCaptureDialog />
      </>,
    );
    await act(async () => {});
    stubDialogRect();

    await fireNativeDrop(INSIDE_BOTH);

    await vi.waitFor(() => expect(importFileMock).toHaveBeenCalled());
    expect(importFileMock).toHaveBeenCalledWith(PHOTO, ZETTEL_ASSETS);
    // 오염된 목적지가 **아니라는 것**을 따로 단정한다: 위 단정만으로는 두
    // 경로를 모두 시도한 코드도 통과한다.
    expect(importFileMock).not.toHaveBeenCalledWith(PHOTO, UNRELATED_ASSETS);
  });

  it("태스크 모드가 켜져 있으면 zettel 수집함이 아니라 태스크 수집 디렉터리로 간다", async () => {
    useSettingsStore.setState({
      tasksCaptureFile: "inbox.md",
      tasksHome: "/vault/tasks-home",
    });
    useZettelSpace();
    // §313 전역 캡처와 같은 경로로 태스크 모드를 켠 채 연다 — 체크박스를 클릭해도
    // 같지만, 이렇게 하면 클릭 이벤트가 아니라 목적지 배선만 시험한다.
    useUIStore.setState({
      quickCaptureOpen: true,
      quickCaptureTaskIntent: true,
    });

    render(
      <>
        <DropHarness editor={makeMainEditor()} />
        <QuickCaptureDialog />
      </>,
    );
    await act(async () => {});
    stubDialogRect();

    await fireNativeDrop(INSIDE_BOTH);

    await vi.waitFor(() => expect(importFileMock).toHaveBeenCalled());
    expect(importFileMock).toHaveBeenCalledWith(PHOTO, TASKS_ASSETS);
    expect(importFileMock).not.toHaveBeenCalledWith(PHOTO, ZETTEL_ASSETS);
  });

  it("목적지가 없으면(zettel 미설정 + 태스크 모드 꺼짐) 활성 탭으로 새지 않는다", async () => {
    useSettingsStore.getState().setZettelkastenEnabled(false);
    useSettingsStore.getState().setZettelkastenDirectory("");
    useFileStore.getState().setRootPath("/vault");
    useUIStore.setState({ quickCaptureOpen: true });

    render(
      <>
        <DropHarness editor={makeMainEditor()} />
        <QuickCaptureDialog />
      </>,
    );
    await act(async () => {});
    stubDialogRect();

    await fireNativeDrop(INSIDE_BOTH);

    // 자기완결형 폴백이 없다(볼트 밖 파일의 바이트를 읽을 수 있는 커맨드가
    // 없다) — 그래서 정답은 "저장하지 않는다", 절대 "활성 탭 옆에 저장한다"가
    // 아니다.
    expect(importFileMock).not.toHaveBeenCalled();
    expect(createDirMock).not.toHaveBeenCalled();
  });
});

describe("§324-e 존 우선순위 — 모달인 캡처 창이 이긴다", () => {
  it("메인 편집기 영역과 겹치는 자리여도 캡처로 간다", async () => {
    useZettelSpace();
    useUIStore.setState({ quickCaptureOpen: true });

    const mainEditor = makeMainEditor();
    render(
      <>
        <DropHarness editor={mainEditor} />
        <QuickCaptureDialog />
      </>,
    );
    await act(async () => {});
    stubDialogRect();

    await fireNativeDrop(INSIDE_BOTH);

    await vi.waitFor(() => expect(importFileMock).toHaveBeenCalled());
    expect(importFileMock).toHaveBeenCalledWith(PHOTO, ZETTEL_ASSETS);
    // 메인 문서에는 아무것도 들어가지 않는다.
    let mainImages = 0;
    mainEditor.state.doc.descendants((n) => {
      if (n.type.name === "image") mainImages++;
    });
    expect(mainImages).toBe(0);
  });

  it("다이얼로그가 열려 있으면 그 밖의 드랍은 뒤의 편집기로 통과하지 않는다", async () => {
    useZettelSpace();
    useUIStore.setState({ quickCaptureOpen: true });

    render(
      <>
        <DropHarness editor={makeMainEditor()} />
        <QuickCaptureDialog />
      </>,
    );
    await act(async () => {});
    stubDialogRect();

    // 모달이 떠 있는 동안 뒤의 편집기는 클릭도 타이핑도 받지 않는다 — 드랍만
    // 통과시킬 이유가 없다.
    await fireNativeDrop(EDITOR_ONLY);

    expect(importFileMock).not.toHaveBeenCalled();
  });

  it("드래그가 캡처 창 위에 있는 동안 그 사실이 화면에 보인다", async () => {
    useZettelSpace();
    useUIStore.setState({ quickCaptureOpen: true });

    render(
      <>
        <DropHarness editor={makeMainEditor()} />
        <QuickCaptureDialog />
      </>,
    );
    await act(async () => {});
    stubDialogRect();

    await fireNativeOver(INSIDE_BOTH);
    expect(
      document.querySelector(".quick-capture-editor.capture-ext-drop-target"),
    ).not.toBeNull();

    // 창을 벗어나면 사라진다 — 남은 강조는 "여기에 놓을 수 있다"는 거짓말이다.
    await act(async () => {
      drag.handler?.({ payload: { type: "leave" } });
    });
    expect(document.querySelector(".capture-ext-drop-target")).toBeNull();
  });
});

describe("§324-e 캡처 창이 없을 때 — 기존 동작 그대로", () => {
  it("편집기 영역 드랍은 활성 탭 옆 assets/로 간다", async () => {
    useZettelSpace();
    useUIStore.setState({ quickCaptureOpen: false });

    render(
      <>
        <DropHarness editor={makeMainEditor()} />
        <QuickCaptureDialog />
      </>,
    );
    await act(async () => {});

    await fireNativeDrop(EDITOR_ONLY);

    await vi.waitFor(() => expect(importFileMock).toHaveBeenCalled());
    expect(importFileMock).toHaveBeenCalledWith(PHOTO, UNRELATED_ASSETS);
  });

  it("파일 트리 드랍은 볼트로 복사된다", async () => {
    useZettelSpace();
    useUIStore.setState({ quickCaptureOpen: false });

    render(
      <>
        <DropHarness editor={makeMainEditor()} />
        <QuickCaptureDialog />
      </>,
    );
    await act(async () => {});

    await fireNativeDrop(TREE_ONLY);

    await vi.waitFor(() => expect(importFileMock).toHaveBeenCalled());
    expect(importFileMock).toHaveBeenCalledWith(PHOTO, "/vault/photo.png");
  });
});
