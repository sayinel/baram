import type { ToastState } from "../../../stores/ui/ui";
import type { Editor } from "@tiptap/react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Slice } from "@tiptap/pm/model";
import { EditorView } from "@tiptap/pm/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// §324-e `copyBytesToDir`는 실물을 쓴다 — 추출이 실제로 어느 경로에 어떤 이름으로
// 쓰려 하는지, 그리고 **취소했을 때 아무것도 부르지 않는지**가 이 브리프의 핵심
// 단정이다. IPC 경계에서만 자른다.
vi.mock("../../../ipc/invoke", () => ({
  appendTaskLine: vi.fn(),
  createDir: vi.fn().mockResolvedValue(undefined),
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
  writeBinaryFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));
// §320 저장 분기 배선만 본다 — 세 갈래 쓰기 경로 자체는 `services/__tests__/capture-append`가
// 검증한다. `CaptureAppendError`는 **실물**이어야 UI의 `instanceof` 분기가 그대로 돈다.
vi.mock("../../../services/capture-append", async (orig) => ({
  ...(await orig<typeof import("../../../services/capture-append")>()),
  appendCaptureToNotes: vi.fn(),
}));
// §324-a 토스트의 [열기]가 실제로 여는 통로. 탭을 진짜로 열지 않고 무엇을 열려 했는지만 본다.
vi.mock("../../../services/journal-file-service", async (orig) => ({
  ...(await orig<typeof import("../../../services/journal-file-service")>()),
  openFileInTab: vi.fn(),
}));
vi.mock("../../../services/zettelkasten-service", () => ({
  captureFleeting: vi.fn().mockResolvedValue({ path: "/z/inbox/x.md" }),
}));
// §307D 다이얼로그 → 훅 → 서비스 배선을 지나는 테스트가 필요하므로 훅은 실물을
// 쓰고 서비스 경계에서만 자른다. `CaptureError`도 실물이어야 UI가 원인별 문구를
// 고르는 `instanceof` 분기가 그대로 돈다.
vi.mock("../../../services/task-capture", async (orig) => ({
  ...(await orig<typeof import("../../../services/task-capture")>()),
  captureTask: vi.fn(),
}));
// §324-e round 2: `resolveCapturePath`(위 mock에서 실물 그대로 남긴 것)는
// 진짜지만, 실제 파일 저장은 자른다 — Rust IPC 없이 어느 경로로 저장을
// *시도*했는지만 본다.
const savePhotoToAssets = vi.fn(
  async (_bytes: Uint8Array, name: string) => `assets/${name}`,
);
vi.mock("../../../utils/journal/journal-photo", () => ({
  savePhotoToAssets: (...a: unknown[]) =>
    savePhotoToAssets(...(a as [Uint8Array, string])),
}));

import { EditorProvider } from "../../../contexts/editor-context";
import { t } from "../../../i18n";
import {
  createDir,
  listDir,
  readFile,
  writeBinaryFile,
} from "../../../ipc/invoke";
import {
  appendCaptureToNotes,
  CaptureAppendError,
} from "../../../services/capture-append";
import { openFileInTab } from "../../../services/journal-file-service";
import {
  buildCaptureLine,
  CaptureError,
  captureTask,
} from "../../../services/task-capture";
import { captureFleeting } from "../../../services/zettelkasten-service";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import {
  CAPTURE_DIALOG_MAX_HEIGHT,
  CAPTURE_DIALOG_MIN_HEIGHT,
} from "../../../stores/settings/journal-settings";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { QuickCaptureDialog } from "../QuickCaptureDialog";

// The save button label embeds a platform-dependent shortcut (⌘↩ / Ctrl+Enter), so the match
// is on the translated text before it rather than the whole label. Pinned to a locale: the
// label used to be Korean on an English default install, which is the defect this now guards.
const LOCALE = "en";
const noSpaceHint = t("journal.capture.error.noSpace", LOCALE);
const sourcePlaceholder = t("journal.capture.source.placeholder", LOCALE);
const tagsPlaceholder = t("journal.capture.tags.placeholder", LOCALE);
const SAVE_PREFIX = t("journal.capture.save", LOCALE).split("{")[0].trim();
// A predicate, not a RegExp: the English label is "Save (…)" and that "(" is an unterminated
// group once it is interpolated into a pattern.
const saveButton = () =>
  screen.getByRole("button", {
    name: (name: string) => name.startsWith(SAVE_PREFIX),
  });

// §323 본문은 이제 Tiptap contenteditable이다 — placeholder 속성으로도, jsdom
// 타이핑으로도 찾거나 채울 수 없다. 다이얼로그가 심어 둔 `_editor` 핸들로 직접
// 내용을 넣고, DOM 텍스트로 읽는다.
const captureEditable = () =>
  document.querySelector(
    ".quick-capture-editor [contenteditable]",
  ) as HTMLElement;
const setCaptureBody = (text: string) => {
  act(() => {
    (
      document.querySelector(".quick-capture-editor") as HTMLElement & {
        _editor?: { commands: { setContent: (value: string) => void } };
      }
    )._editor?.commands.setContent(text ? `<p>${text}</p>` : "");
  });
};

// §324-e round 2: paste an image straight into the capture editor's real
// ProseMirror `handlePaste` — the same `_editor` handle `setCaptureBody`
// uses, but exercising the actual DropHandler plugin instead of `setContent`.
function pasteImageInCapture(name = "shot.png", content = "x"): void {
  pasteFilesInCapture([new File([content], name, { type: "image/png" })]);
}

/** 파일 여럿을 담은 한 번의 붙여넣기 — `handlePaste`의 순차 루프를 태운다. */
function pasteFilesInCapture(files: File[]): void {
  const editor = (
    document.querySelector(".quick-capture-editor") as HTMLElement & {
      _editor?: Editor;
    }
  )._editor!;
  const event = {
    clipboardData: { files, getData: () => "" },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
  act(() => {
    editor.view.someProp("handlePaste", (f) =>
      f(editor.view, event, Slice.empty),
    );
  });
}

/**
 * §324-e 붙여넣기 삽입은 `FileReader`를 거치므로 비동기다. 이 대기가 없으면
 * 뒤따르는 "쓰지 않았다" 단정이 "아직 아무 일도 일어나지 않았다"로도 통과한다.
 * `count`는 지금까지 넣은 이미지 수 — 노드가 실제로 그만큼 들어왔는지까지 본다.
 */
async function waitForCaptureImages(count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(document.querySelectorAll(".quick-capture-editor img")).toHaveLength(
      count,
    );
  });
}

const cancelButton = () =>
  screen.getByRole("button", { name: t("common.cancel", LOCALE) });

// ‼️ 두 §324-e 테스트가 스토어의 `showToast`를 `vi.fn()`으로 갈아 끼워 무엇이 불렸는지
// 본다. 되돌리지 않으면 그 뒤로 이 파일의 **모든** 토스트가 아무 데도 도착하지 않고,
// 토스트를 단정하는 테스트는 "아무 일도 없었다"를 보며 조용히 통과한다(§320 describe에서
// 실제로 그렇게 다섯 개가 깨져 원인을 여기까지 따라왔다). 모듈 로드 시점의 진짜 구현을
// 잡아 두었다가 그 describe의 afterEach에서 되돌린다.
const REAL_SHOW_TOAST = useUIStore.getState().showToast;

/** 지금 캡처 본문 — 저장 실패 후 사용자의 글이 남아 있는지 확인용. */
const captureHtml = (): string =>
  (
    document.querySelector(".quick-capture-editor") as HTMLElement & {
      _editor?: Editor;
    }
  )._editor!.getHTML();

describe("QuickCaptureDialog — zettel space gating (§95/§99 M4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ locale: LOCALE });
    useSettingsStore.getState().setZettelkastenEnabled(false);
    useSettingsStore.getState().setZettelkastenDirectory("");
    useFileStore.getState().setRootPath(null as unknown as string);
    useUIStore.setState({ quickCaptureOpen: true });
  });

  it("shows the setup hint and disables Save immediately when the zettel space isn't configured", () => {
    render(<QuickCaptureDialog />);

    expect(screen.getByText(noSpaceHint)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("hides the hint and enables Save once the zettel space is configured", () => {
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");

    render(<QuickCaptureDialog />);
    setCaptureBody("hello");

    expect(screen.queryByText(noSpaceHint)).not.toBeInTheDocument();
    expect(saveButton()).not.toBeDisabled();
  });

  it("passes the composed body to captureFleeting on save (no capture type)", async () => {
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
    useUIStore.setState({ quickCaptureOpen: true });

    render(<QuickCaptureDialog />);
    setCaptureBody("a fleeting thought");
    fireEvent.click(saveButton());

    await vi.waitFor(() => {
      // No capture type param (§99 A); tags arg is an empty array when none typed.
      expect(captureFleeting).toHaveBeenCalledWith(
        "/vault/zettel",
        expect.stringContaining("a fleeting thought"),
        [],
      );
    });
  });

  it("folds the optional source into the captured body", async () => {
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
    useUIStore.setState({ quickCaptureOpen: true });

    render(<QuickCaptureDialog />);
    setCaptureBody("note body");
    fireEvent.change(screen.getByPlaceholderText(sourcePlaceholder), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(saveButton());

    await vi.waitFor(() => {
      expect(captureFleeting).toHaveBeenCalledWith(
        "/vault/zettel",
        expect.stringContaining("Source: https://example.com"),
        [],
      );
    });
  });

  it("passes typed tags as an array (frontmatter), not inline in the body (§99 A)", async () => {
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
    useUIStore.setState({ quickCaptureOpen: true });

    render(<QuickCaptureDialog />);
    setCaptureBody("note body");
    fireEvent.change(screen.getByPlaceholderText(tagsPlaceholder), {
      target: { value: "#idea #todo" },
    });
    // §320 태그를 적은 캡처는 그 태그가 무엇을 지목하는지 알기 전에는 저장하지 않는다
    // (`scanPending`). 스캔이 끝나면 버튼이 다시 살아난다 — 그것이 여기서 기다릴 수 있는
    // 신호다. 이 픽스처의 `listDir`은 빈 목록을 주므로 대상은 없고, 저장은 지금까지처럼
    // `inbox/`로 간다.
    await vi.waitFor(() => expect(saveButton()).not.toBeDisabled());
    fireEvent.click(saveButton());

    await vi.waitFor(() => {
      expect(captureFleeting).toHaveBeenCalledWith(
        "/vault/zettel",
        expect.stringContaining("note body"),
        ["idea", "todo"],
      );
    });
    // The tags must not leak into the body argument
    const bodyArg = vi.mocked(captureFleeting).mock.calls.at(-1)![1];
    expect(bodyArg).not.toContain("#idea");
  });
});

describe("QuickCaptureDialog — memo editor & dismissal guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ locale: LOCALE });
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
    useUIStore.setState({ quickCaptureOpen: true });
  });

  const overlay = () => document.querySelector(".quick-capture-overlay")!;

  // ‼️ §323 리뷰 Minor 9 이후로 mousedown이 빠지면 안 된다. 진짜 클릭에는 반드시
  // 앞서는 mousedown이 있고, 다이얼로그는 이제 그 누름이 어디서 시작했는지로
  // "바깥 클릭"과 "안에서 시작해 밖에서 끝난 드래그"를 가른다. `fireEvent.click`은
  // click만 쏘므로, 그것만 쓰면 실제로 일어날 수 없는 입력을 시험하게 된다.
  const clickOutside = () => {
    fireEvent.mouseDown(overlay());
    fireEvent.click(overlay());
  };

  it("does NOT save on plain Enter", () => {
    render(<QuickCaptureDialog />);
    setCaptureBody("line one");
    fireEvent.keyDown(captureEditable(), { key: "Enter" });

    expect(captureFleeting).not.toHaveBeenCalled();
    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
  });

  it("saves on Mod+Enter", async () => {
    render(<QuickCaptureDialog />);
    setCaptureBody("a captured line");
    fireEvent.keyDown(captureEditable(), { key: "Enter", metaKey: true });

    await vi.waitFor(() => {
      expect(captureFleeting).toHaveBeenCalledWith(
        "/vault/zettel",
        expect.stringContaining("a captured line"),
        [],
      );
    });
    expect(useUIStore.getState().quickCaptureOpen).toBe(false);
  });

  // ‼️ 위 테스트는 `metaKey`만 보낸다. ProseMirror는 `navigator.platform`으로 Mac을
  // 판정해 `Mod-`를 가르고 jsdom은 Mac이 아니므로, `metaKey`로는 PM 키맵이 아예
  // 매칭되지 않는다 — 즉 저 테스트는 React 핸들러만 태우고 편집기 안의 키맵과의
  // 상호작용을 보지 못한다.
  //
  // §324-e에서 캡처 프로필은 `Mod-Enter`를 가로채 하드 브레이크를 막는다
  // (`CaptureSaveKey`). 그 가로채기가 저장까지 삼켜 버리면 사용자는 `\`가 사라진
  // 대신 저장을 잃는다. `ctrlKey`로 보내 키맵을 **실제로** 태우고, 그러고도 저장이
  // 일어나는지 본다.
  it("Mod+Enter가 키맵을 실제로 태워도 저장은 일어난다", async () => {
    render(<QuickCaptureDialog />);
    setCaptureBody("a captured line");
    fireEvent.keyDown(captureEditable(), { ctrlKey: true, key: "Enter" });

    await vi.waitFor(() => {
      expect(captureFleeting).toHaveBeenCalledWith(
        "/vault/zettel",
        expect.stringContaining("a captured line"),
        [],
      );
    });
    // 그리고 하드 브레이크가 본문에 섞이지 않았다.
    const body = vi.mocked(captureFleeting).mock.calls[0][1];
    expect(body).not.toContain("\\");
    expect(useUIStore.getState().quickCaptureOpen).toBe(false);
  });

  it("ignores outside clicks while any content is typed", () => {
    render(<QuickCaptureDialog />);
    setCaptureBody("x");
    clickOutside();

    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
  });

  it("closes on outside click when nothing is typed", () => {
    render(<QuickCaptureDialog />);
    clickOutside();

    expect(useUIStore.getState().quickCaptureOpen).toBe(false);
  });

  it("ignores Escape while content is typed, closes when empty", () => {
    render(<QuickCaptureDialog />);
    setCaptureBody("x");
    fireEvent.keyDown(captureEditable(), { key: "Escape" });
    expect(useUIStore.getState().quickCaptureOpen).toBe(true);

    setCaptureBody("");
    fireEvent.keyDown(captureEditable(), { key: "Escape" });
    expect(useUIStore.getState().quickCaptureOpen).toBe(false);
  });

  it("Cancel button closes even with content typed", () => {
    render(<QuickCaptureDialog />);
    setCaptureBody("precious note");
    fireEvent.click(screen.getByText(t("common.cancel", "en")));

    expect(useUIStore.getState().quickCaptureOpen).toBe(false);
  });
});

// §307D Task 3에는 컴포넌트 레벨 테스트가 하나도 없었다 — 체크박스도, 저장 분기도,
// 오류 경로도 렌더된 적이 없다(리뷰 Minor 4).
describe("QuickCaptureDialog — task mode (§307D)", () => {
  const taskToggle = () =>
    screen.getByRole("checkbox", {
      name: t("journal.capture.taskMode.label", LOCALE),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(captureTask).mockResolvedValue("- [ ] x ➕2026-08-25");
    useSettingsStore.setState({
      locale: LOCALE,
      tasksCaptureFile: "tasks/inbox.md",
    });
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
    useUIStore.setState({ quickCaptureOpen: true });
  });

  it("appends to the capture file instead of creating a fleeting note", async () => {
    render(<QuickCaptureDialog />);
    fireEvent.click(taskToggle());
    setCaptureBody("은행 연락");
    fireEvent.click(saveButton());

    await vi.waitFor(() => {
      expect(captureTask).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "은행 연락",
          captureFile: "tasks/inbox.md",
        }),
      );
    });
    expect(captureFleeting).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(useUIStore.getState().quickCaptureOpen).toBe(false),
    );
  });

  it("folds the typed tags into the captured line", async () => {
    // The tag field autocompletes `#someday` — the very triage vocabulary this
    // slice built. Dropping it here breaks that vocabulary at the capture point.
    render(<QuickCaptureDialog />);
    fireEvent.click(taskToggle());
    setCaptureBody("Rust 배우기");
    fireEvent.change(screen.getByPlaceholderText(tagsPlaceholder), {
      target: { value: "#someday" },
    });
    fireEvent.click(saveButton());

    await vi.waitFor(() => {
      expect(captureTask).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ["someday"] }),
      );
    });
  });

  it("hides the Source field — §18.0 a task is a line and carries no source", () => {
    render(<QuickCaptureDialog />);
    expect(screen.getByPlaceholderText(sourcePlaceholder)).toBeInTheDocument();

    fireEvent.click(taskToggle());

    expect(
      screen.queryByPlaceholderText(sourcePlaceholder),
    ).not.toBeInTheDocument();
  });

  it("keeps Save enabled without a zettel space — task mode does not use one", () => {
    useSettingsStore.getState().setZettelkastenEnabled(false);
    render(<QuickCaptureDialog />);
    setCaptureBody("은행 연락");
    expect(saveButton()).toBeDisabled();

    fireEvent.click(taskToggle());

    expect(saveButton()).not.toBeDisabled();
    expect(screen.queryByText(noSpaceHint)).not.toBeInTheDocument();
  });

  it("keeps the dialog open with the text intact when the capture fails", async () => {
    vi.mocked(captureTask).mockRejectedValue(
      new CaptureError("dirtyTab", "unsaved"),
    );
    render(<QuickCaptureDialog />);
    fireEvent.click(taskToggle());
    setCaptureBody("은행 연락");
    fireEvent.click(saveButton());

    await screen.findByText(t("journal.capture.error.taskDirtyTab", LOCALE));
    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
    expect(captureEditable().textContent).toBe("은행 연락");
  });

  it("names the actual cause instead of blaming the capture file", async () => {
    vi.mocked(captureTask).mockRejectedValue(
      new CaptureError("noTasksHome", "no tasks home"),
    );
    render(<QuickCaptureDialog />);
    fireEvent.click(taskToggle());
    setCaptureBody("은행 연락");
    fireEvent.click(saveButton());

    await screen.findByText(t("journal.capture.error.taskNoHome", LOCALE));
    expect(
      screen.queryByText(t("journal.capture.error.taskSave", LOCALE)),
    ).not.toBeInTheDocument();
  });

  it("resets to off when the dialog reopens — each capture is a fresh decision", () => {
    // The dialog returns null rather than unmounting, so the mode survives a
    // close. Left sticky, the next ⌘⇧N memo silently becomes a line in Inbox.md.
    render(<QuickCaptureDialog />);
    fireEvent.click(taskToggle());
    expect(taskToggle()).toBeChecked();

    act(() => useUIStore.setState({ quickCaptureOpen: false }));
    act(() => useUIStore.setState({ quickCaptureOpen: true }));

    expect(taskToggle()).not.toBeChecked();
  });
});

// §324-e round 3 — **저장을 누르기 전에는 아무것도 디스크에 닿지 않는다.**
//
// 사용자가 실물에서 찾은 결함 셋이 하나의 원인에서 나왔다: 드랍·붙여넣기가 즉시
// 최종 목적지에 파일을 썼다. 그래서 (1) 취소해도 이미지가 assets/에 남았고,
// (2) 캡처 상자에는 그림 대신 alt 텍스트만 보였고(탭이 아닌 표면에는 상대참조를
// 풀 baseDir이 없다), (3) 붙여넣기도 드랍과 똑같이 그랬다.
//
// 목적지 계약(round 2)은 버려지지 않고 **저장 시점으로 옮겨 갔다** — 태스크 모드는
// 태스크 홈 아래, 그 외에는 zettel 수집함 아래. 아래 두 describe가 각각
// "쓰지 않는다"와 "저장할 때 어디에 쓴다"를 본다.
describe("QuickCaptureDialog — §324-e 저장 전에는 쓰지 않는다", () => {
  const originalEditorState = useEditorStore.getState();
  const originalSettingsState = useSettingsStore.getState();
  const originalFileState = useFileStore.getState();

  beforeEach(() => {
    vi.clearAllMocks();
    savePhotoToAssets.mockClear();
    vi.mocked(listDir).mockResolvedValue([]);
    vi.mocked(createDir).mockResolvedValue(undefined);
    vi.mocked(writeBinaryFile).mockResolvedValue(undefined);
    useSettingsStore.setState({ locale: LOCALE });
    useUIStore.setState({ quickCaptureOpen: true });
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
  });

  afterEach(() => {
    useEditorStore.setState(originalEditorState, true);
    useSettingsStore.setState(originalSettingsState, true);
    useFileStore.setState(originalFileState, true);
  });

  it("붙여넣기만으로는 디렉터리도 파일도 만들지 않는다", async () => {
    render(<QuickCaptureDialog />);
    pasteImageInCapture("pearl-2.png");
    await waitForCaptureImages(1);

    expect(createDir).not.toHaveBeenCalled();
    expect(writeBinaryFile).not.toHaveBeenCalled();
    expect(savePhotoToAssets).not.toHaveBeenCalled();
    // 그림은 실제로 그려진다 — alt 텍스트만 뜨던 결함의 반대편. data URL은
    // baseDir을 묻지 않는 유일한 형태이므로 캡처 상자에서도 해석된다.
    const img = document.querySelector(".quick-capture-editor img")!;
    expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  });

  // ‼️ 사용자의 문장 그대로: "'저장'을 누른 경우에만 이미지가 assets에 저장 되어야".
  it("취소하면 아무것도 디스크에 남지 않는다", async () => {
    render(<QuickCaptureDialog />);
    pasteImageInCapture("pearl-2.png");
    await waitForCaptureImages(1);

    await act(async () => {
      fireEvent.click(cancelButton());
    });

    expect(createDir).not.toHaveBeenCalled();
    expect(writeBinaryFile).not.toHaveBeenCalled();
    expect(savePhotoToAssets).not.toHaveBeenCalled();
    expect(captureFleeting).not.toHaveBeenCalled();
    expect(captureTask).not.toHaveBeenCalled();
    expect(useUIStore.getState().quickCaptureOpen).toBe(false);
  });

  it("태스크 모드에서 취소해도 마찬가지다", async () => {
    useSettingsStore.setState({
      tasksHome: "/vault/tasks-home",
      tasksCaptureFile: "inbox.md",
    });
    render(<QuickCaptureDialog />);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: t("journal.capture.taskMode.label", LOCALE),
      }),
    );
    pasteImageInCapture("pearl-2.png");
    await waitForCaptureImages(1);

    await act(async () => {
      fireEvent.click(cancelButton());
    });

    expect(createDir).not.toHaveBeenCalled();
    expect(writeBinaryFile).not.toHaveBeenCalled();
    expect(captureTask).not.toHaveBeenCalled();
  });
});

describe("QuickCaptureDialog — §324-e 저장이 파일을 만든다", () => {
  const taskToggle = () =>
    screen.getByRole("checkbox", {
      name: t("journal.capture.taskMode.label", LOCALE),
    });
  const originalEditorState = useEditorStore.getState();
  const originalSettingsState = useSettingsStore.getState();
  const originalFileState = useFileStore.getState();

  /**
   * `listDir`이 방금 쓴 파일을 반영하는 충실한 대역. 언제나 `[]`를 돌려주는
   * 대역으로는 `resolveNameConflict`가 첫 파일을 보지 못해 "이름이 같은 이미지
   * 둘이 서로 다른 파일이 된다"는 단정이 구조적으로 통과할 수 없다.
   */
  function fakeDisk(): Map<string, unknown> {
    const disk = new Map<string, unknown>();
    vi.mocked(writeBinaryFile).mockImplementation(async (path, data) => {
      disk.set(path, data);
    });
    vi.mocked(listDir).mockImplementation(async (dir) =>
      [...disk.keys()]
        .filter((p) => p.slice(0, p.lastIndexOf("/")) === dir)
        .map((p) => ({
          isDir: false,
          modifiedAt: 0,
          name: p.slice(p.lastIndexOf("/") + 1),
          path: p,
          size: 0,
        })),
    );
    return disk;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    savePhotoToAssets.mockClear();
    vi.mocked(createDir).mockResolvedValue(undefined);
    vi.mocked(captureFleeting).mockResolvedValue({ path: "/z/inbox/x.md" });
    useSettingsStore.setState({ locale: LOCALE });
    useUIStore.setState({ quickCaptureOpen: true });
    useFileStore.getState().setRootPath("/vault");
  });

  afterEach(() => {
    useEditorStore.setState(originalEditorState, true);
    useSettingsStore.setState(originalSettingsState, true);
    useFileStore.setState(originalFileState, true);
    // 아래 두 테스트가 갈아 끼운 `showToast`를 되돌린다 — `REAL_SHOW_TOAST` 주석 참조.
    useUIStore.setState({ showToast: REAL_SHOW_TOAST });
  });

  it("zettel — 수집함의 assets/ 아래에, 원본 파일명으로 쓴다", async () => {
    fakeDisk();
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");

    render(<QuickCaptureDialog />);
    pasteImageInCapture("pearl-2.png");
    await waitForCaptureImages(1);

    await act(async () => {
      fireEvent.click(saveButton());
    });

    // 목적지는 `${zettelDir}/inbox` — `captureFleeting`이 노트를 쓰는 그
    // 디렉터리다. 그래서 노트에 남는 `assets/…` 상대참조가 실제 파일을 가리킨다.
    expect(createDir).toHaveBeenCalledWith("/vault/zettel/inbox/assets");
    expect(writeBinaryFile).toHaveBeenCalledWith(
      "/vault/zettel/inbox/assets/pearl-2.png",
      expect.any(Array),
    );

    const body = vi.mocked(captureFleeting).mock.calls[0][1];
    expect(body).toContain("![pearl-2.png](assets/pearl-2.png)");
    // ‼️ 참조가 남는 것만으로는 부족하다 — data URL이 **함께** 남으면 노트에
    // 거대한 base64가 실린다.
    expect(body).not.toContain("data:");
  });

  // ‼️ 이름이 좁은 이유를 먼저 적는다: 이 테스트는 **저장 단계만** 본다. 문서에
  // 이미 이미지 둘이 있는 상태에서 출발하고, 그 상태를 붙여넣기로 만들지
  // 않는다 — 만들 수 없기 때문이다.
  //
  // `insertMediaAtPos`는 위치 없이 `replaceSelectionWith`로 삽입하고 첫 삽입 뒤
  // 선택이 그 노드에 놓이므로, 파일 둘을 한 번에 붙여넣어도 두 번째가 첫 번째를
  // **대체한다**. 세 가지 방법(연속 붙여넣기, 한 번에 두 파일, 사이에 커서
  // 이동)을 다 시도해 확인했다. 이 브랜치가 만든 결함이 아니라 문서 편집기도
  // 공유하는 기존 동작이고, 범위 밖이라 고치지 않는다.
  //
  // 그러므로 이 테스트는 "여러 이미지"를 덮지 **않는다** — 삽입 단계가 애초에
  // 여럿을 만들지 못한다. 진짜 다중 삽입은 드랍 경로가 덮는다:
  // `use-external-drop.test.ts`의 "여러 파일이 서로를 덮지 않고 순서대로
  // 들어간다"가 `handleCaptureDrop`을 파일 둘로 돌린다(그쪽은 `insertNodeAtPos`로
  // 위치를 전진시키므로 실제로 둘이 남는다).
  it("저장이 이름 충돌을 푼다 — 같은 이름의 data URL 둘이 서로 다른 파일이 된다", async () => {
    const disk = fakeDisk();
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");

    render(<QuickCaptureDialog />);
    // 내용이 달라야 서로 다른 data URL이 된다 — 같은 바이트는 같은 이미지이므로
    // `collectPendingMedia`가 한 건으로 합친다(그쪽은 그것이 옳다).
    act(() => {
      (
        document.querySelector(".quick-capture-editor") as HTMLElement & {
          _editor?: Editor;
        }
      )._editor!.commands.setContent(
        `<p><img src="data:image/png;base64,Zmlyc3Q=" alt="shot.png"></p>` +
          `<p><img src="data:image/png;base64,c2Vjb25k" alt="shot.png"></p>`,
      );
    });
    await waitForCaptureImages(2);

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect([...disk.keys()].sort()).toEqual([
      "/vault/zettel/inbox/assets/shot-1.png",
      "/vault/zettel/inbox/assets/shot.png",
    ]);
    const body = vi.mocked(captureFleeting).mock.calls[0][1];
    expect(body).toContain("assets/shot.png");
    expect(body).toContain("assets/shot-1.png");
    expect(body).not.toContain("data:");
  });

  // §324-e round 2가 잡은 것을 저장 시점에서 다시 고정한다: 태스크 모드는 zettel
  // 공간과 무관한 별도 설정(`tasks-home.ts`)이라, 목적지를 설정에서 재계산하는
  // 구현은 이 분기를 놓치고 zettel 수집함에 쓴다.
  it("태스크 모드 — 태스크 수집함의 assets/ 아래에 쓴다, zettel이 아니라", async () => {
    fakeDisk();
    useSettingsStore.setState({
      tasksHome: "/vault/tasks-home",
      tasksCaptureFile: "inbox.md",
    });
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");

    render(<QuickCaptureDialog />);
    fireEvent.click(taskToggle());
    pasteImageInCapture("shot.png");
    await waitForCaptureImages(1);

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(writeBinaryFile).toHaveBeenCalledWith(
      "/vault/tasks-home/tasks/assets/shot.png",
      expect.any(Array),
    );
    expect(writeBinaryFile).not.toHaveBeenCalledWith(
      expect.stringContaining("/vault/zettel/"),
      expect.anything(),
    );
  });

  // ‼️ 이미지를 넣었는데 링크가 되는 것은 **조용히** 일어나서는 안 된다. 사용자는
  // 파일을 열어 보고 나서야 알게 되고, 그것이 이 스레드가 계속 고쳐 온 실패 방식이다.
  it("태스크 모드 — 이미지가 링크가 되면 그 사실을 알린다", async () => {
    fakeDisk();
    useSettingsStore.setState({
      tasksHome: "/vault/tasks-home",
      tasksCaptureFile: "inbox.md",
    });
    const showToast = vi.fn();
    useUIStore.setState({ showToast } as never);

    render(<QuickCaptureDialog />);
    fireEvent.click(taskToggle());
    pasteImageInCapture("fig.png");
    await waitForCaptureImages(1);

    await act(async () => {
      fireEvent.click(saveButton());
    });

    const messages = showToast.mock.calls.map((c) => c[0] as string);
    expect(messages.some((m) => m.includes("link"))).toBe(true);
  });

  // 대조군 — 이미지가 없으면 알리지 않는다. 없으면 위 테스트는 "언제나 알린다"는
  // 구현도 통과한다.
  it("태스크 모드 — 이미지가 없으면 알리지 않는다", async () => {
    fakeDisk();
    useSettingsStore.setState({
      tasksHome: "/vault/tasks-home",
      tasksCaptureFile: "inbox.md",
    });
    const showToast = vi.fn();
    useUIStore.setState({ showToast } as never);

    render(<QuickCaptureDialog />);
    fireEvent.click(taskToggle());
    setCaptureBody("이미지 없는 태스크");

    await act(async () => {
      fireEvent.click(saveButton());
    });

    const messages = showToast.mock.calls.map((c) => c[0] as string);
    expect(messages.some((m) => m.includes("link"))).toBe(false);
  });

  // ‼️ 순서가 이 테스트의 전부다. `captureTask`는 본문을 `- [ ] …` **한 줄**로
  // 접으므로, 추출이 그 뒤에 일어나면 거대한 base64 문자열이 이미 plain-text
  // 태스크 목록의 한 줄이 된 뒤다. 어떤 렌더러도 그것을 되돌려 주지 않는다.
  it("태스크 모드 — 추출이 태스크 줄을 만들기 전에 끝난다", async () => {
    fakeDisk();
    useSettingsStore.setState({
      tasksHome: "/vault/tasks-home",
      tasksCaptureFile: "inbox.md",
    });

    render(<QuickCaptureDialog />);
    fireEvent.click(taskToggle());
    pasteImageInCapture("shot.png");
    await waitForCaptureImages(1);

    await act(async () => {
      fireEvent.click(saveButton());
    });

    const { body } = vi.mocked(captureTask).mock.calls[0][0];
    expect(body).not.toContain("data:");
    // 실제로 파일에 적히는 줄을 진짜 `buildCaptureLine`으로 만들어 본다 — 본문만
    // 보는 단정은 그 줄을 만드는 단계가 무엇을 하는지 말하지 못한다.
    const line = buildCaptureLine(body, "2026-09-02", [])!;
    expect(line).not.toContain("data:");
    expect(line).toContain("assets/shot.png");
  });

  // ‼️ 순서의 나머지 절반. 추출이 실패하면 노트를 **쓰지 않는다** — 존재하지 않는
  // 파일을 가리키는 참조가 노트에 남는 것이 이 작업이 없애려는 결함이고, 저장
  // 시점으로 옮겨 놓기만 하면 고친 것이 아니다. 그러면서 사용자의 글도 잃지
  // 않는다: 다이얼로그는 열린 채로 남는다(저장 실패의 기존 계약).
  it("추출이 실패하면 노트를 쓰지 않고 본문을 지킨다", async () => {
    fakeDisk();
    vi.mocked(writeBinaryFile).mockRejectedValue(new Error("disk full"));
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");

    render(<QuickCaptureDialog />);
    setCaptureBody("잃어버리면 안 되는 문장");
    pasteImageInCapture("pearl-2.png");
    await waitForCaptureImages(1);

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(captureFleeting).not.toHaveBeenCalled();
    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
    expect(captureHtml()).toContain("잃어버리면 안 되는 문장");
    expect(
      screen.getByText(t("journal.capture.error.media", LOCALE)),
    ).toBeInTheDocument();
  });

  // 목적지가 없으면 아무것도 쓰지 않고, 사용자는 **원인에 맞는** 문구를 본다.
  // 여기서 추출이 따로 오류를 만들면 "이미지를 저장하지 못했다"가 뜨는데, 진짜
  // 원인은 태스크 홈이 없다는 것이다.
  it("태스크 홈이 없으면 파일을 쓰지 않고 그 원인을 말한다", async () => {
    fakeDisk();
    useSettingsStore.setState({ tasksHome: "", tasksCaptureFile: "inbox.md" });
    useSettingsStore.getState().setZettelkastenEnabled(false);
    useSettingsStore.getState().setZettelkastenDirectory("");
    vi.mocked(captureTask).mockRejectedValue(
      new CaptureError("noTasksHome", "no tasks home"),
    );

    render(<QuickCaptureDialog />);
    fireEvent.click(taskToggle());
    pasteImageInCapture("shot.png");
    await waitForCaptureImages(1);

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(createDir).not.toHaveBeenCalled();
    expect(writeBinaryFile).not.toHaveBeenCalled();
    expect(
      screen.getByText(t("journal.capture.error.taskNoHome", LOCALE)),
    ).toBeInTheDocument();
  });

  it("zettel 미설정 + 태스크 모드 꺼짐 — 메인 창의 활성 탭으로 새지 않는다", async () => {
    fakeDisk();
    useSettingsStore.getState().setZettelkastenEnabled(false);
    useSettingsStore.getState().setZettelkastenDirectory("");
    // §324-e round 1의 재현 상태: 캡처와 무관한 문서 탭이 메인 창에 열려 있고,
    // `journalDirectory` 접두사와 일치하도록 저널처럼 생긴 경로다 — 즉시 쓰기가
    // 되살아나면 `getJournalContext`가 이 탭을 저널 쓰기로 보고 실제로 그 옆에
    // 저장한다. 저널처럼 생기지 않은 탭은 두 코드를 구별하지 못한다.
    useSettingsStore.setState({ journalDirectory: "/vault/notes" });
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [{ id: "t1", filePath: "/vault/notes/unrelated.md" }],
    } as never);

    render(<QuickCaptureDialog />);
    pasteImageInCapture();
    await waitForCaptureImages(1);

    expect(savePhotoToAssets).not.toHaveBeenCalled();
    expect(writeBinaryFile).not.toHaveBeenCalled();
    const img = document.querySelector(".quick-capture-editor img")!;
    expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  });
});

describe("§323 WYSIWYG 본문", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ locale: LOCALE });
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/z");
    useUIStore.setState({
      quickCaptureOpen: true,
      quickCaptureTaskIntent: false,
    });
  });

  it("textarea가 아니라 contenteditable을 보여준다", async () => {
    render(<QuickCaptureDialog />);
    await act(async () => {});
    expect(document.querySelector(".quick-capture-textarea")).toBeNull();
    expect(
      document.querySelector(".quick-capture-editor [contenteditable]"),
    ).not.toBeNull();
  });

  // ‼️ §323 리뷰 Important 3 회귀 핀. `journal.capture.body.placeholder`가
  // 아무 데서도 참조되지 않는 채로 남고, `editor/base.css`가 한국어 문장을
  // `content:`에 박아 두어 영어 사용자가 한국어 안내를 봤다. CSS 쪽 절반은
  // `styles/__tests__/capture-editor-surface.test.ts`가 고정한다 — 여기서는
  // 실제로 어떤 문자열이 DOM에 실리는지, 즉 로케일 분기를 본다.
  it.each(["en", "ko"] as const)(
    "빈 본문 안내 문구가 %s 로케일을 따른다",
    async (locale) => {
      useSettingsStore.setState({ locale });
      render(<QuickCaptureDialog />);
      await act(async () => {});
      const empty = document.querySelector(
        ".quick-capture-editor [data-placeholder]",
      );
      expect(empty).not.toBeNull();
      // 두 로케일의 값이 서로 다르므로, 어느 한쪽을 하드코딩한 구현은 반드시
      // 한쪽에서 실패한다 — 로케일을 아예 안 읽는 구현도 마찬가지다.
      expect(empty!.getAttribute("data-placeholder")).toBe(
        t("journal.capture.body.placeholder", locale),
      );
    },
  );

  // ‼️ §323 autofocus 회귀 핀. 이 effect(`QuickCaptureDialog.tsx`의
  // `captureEditorInstance?.commands.focus()`)는 브리프 밖 범위로 승인된 코드이고,
  // 없으면 창을 열 때마다 클릭을 한 번 해야 타이핑이 시작된다 — textarea 시절의
  // 자동 포커스 계약이 깨진다. 승인까지 받아 넣은 회귀 방지 코드에 핀이 없었다.
  //
  // `document.activeElement`로는 못 본다: jsdom은 tabindex 없는 contenteditable을
  // 포커스 대상으로 치지 않아, effect가 정상 동작해도 activeElement가 BODY로
  // 남는다(실측). 그래서 결과가 아니라 기계를 단정한다 — Tiptap의 `focus()`
  // 커맨드는 `requestAnimationFrame` 안에서 `EditorView.prototype.focus()`를
  // 부른다(@tiptap/core의 `delayedFocus`). rAF를 기다려야 하는 이유도 그것이다.
  it("창이 열리면 캡처 편집기로 포커스가 간다", async () => {
    const focusSpy = vi.spyOn(EditorView.prototype, "focus");
    try {
      render(<QuickCaptureDialog />);
      await act(async () => {});

      await vi.waitFor(() => {
        expect(focusSpy).toHaveBeenCalled();
      });
      // 아무 뷰나가 아니라 캡처 편집기의 뷰여야 한다.
      const editor = (
        document.querySelector(".quick-capture-editor") as HTMLElement & {
          _editor?: Editor;
        }
      )._editor!;
      expect(focusSpy.mock.instances).toContain(editor.view);
    } finally {
      focusSpy.mockRestore();
    }
  });

  it("서식 있는 본문이 마크다운으로 저장된다", async () => {
    render(<QuickCaptureDialog />);
    await act(async () => {});
    const view = document.querySelector(".quick-capture-editor");
    // 편집기 인스턴스에 직접 넣는다 — jsdom에서 contenteditable 타이핑은 신뢰할 수 없다.
    await act(async () => {
      (
        view as HTMLElement & {
          _editor?: { commands: { setContent: (v: string) => void } };
        }
      )._editor?.commands.setContent("<p><strong>굵게</strong> 보통</p>");
    });
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(captureFleeting).toHaveBeenCalled();
    const body = (captureFleeting as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body).toContain("**굵게**");
  });

  // ‼️ 한글 IME 회귀 핀 — §323이 가장 깨지기 쉽다고 지목한 그 동작
  // (`part19-capture-to-hub.md:353-356`)이고, `QuickCaptureDialog.tsx`의
  // `e.nativeEvent.isComposing` 가드를 지킨다.
  //
  // 이 테스트의 첫 판은 본문을 채우지 않았다. 그래서 `handleSave`가 조합 여부를
  // 물어보기도 전에 `isEmpty` 가드에서 되돌아갔고, 가드를 통째로 지워도 그대로
  // 통과했다 — "저장되지 않았다"를 확인하면서 실은 "저장 로직에 닿지도 못했다"를
  // 보고 있었다. 본문을 먼저 채우는 것이 이 핀의 전부다.
  //
  // 두 단계를 한 테스트에 두는 이유: 두 번째 단계(조합이 끝나면 같은 키가
  // 실제로 저장한다)가 없으면 첫 단계는 다시 진공이 된다. 어떤 이유로든
  // 픽스처가 `handleSave`에 못 닿게 되면 — 본문 주입이 깨지든, zettel 게이트가
  // 막히든 — 두 번째 단계가 실패해서 그 사실을 말해 준다.
  it("IME 조합 중 Mod+Enter는 저장하지 않는다 — 조합이 끝나면 저장한다", async () => {
    render(<QuickCaptureDialog />);
    await act(async () => {});
    setCaptureBody("조합 중인 글");
    const editable = captureEditable();

    fireEvent.keyDown(editable, {
      key: "Enter",
      metaKey: true,
      ctrlKey: true,
      isComposing: true,
    });
    await act(async () => {});
    expect(captureFleeting).not.toHaveBeenCalled();

    // 같은 본문, 같은 키 — 조합만 끝났다.
    fireEvent.keyDown(editable, {
      key: "Enter",
      metaKey: true,
      ctrlKey: true,
    });
    await vi.waitFor(() => {
      expect(captureFleeting).toHaveBeenCalled();
    });
  });

  it("본문이 있으면 Escape로 닫히지 않는다", async () => {
    render(<QuickCaptureDialog />);
    await act(async () => {});
    const view = document.querySelector(".quick-capture-editor");
    await act(async () => {
      (
        view as HTMLElement & {
          _editor?: { commands: { setContent: (v: string) => void } };
        }
      )._editor?.commands.setContent("<p>쓰던 글</p>");
    });
    fireEvent.keyDown(document.querySelector(".quick-capture-dialog")!, {
      key: "Escape",
    });
    await act(async () => {});
    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
  });

  it("본문이 비어 있으면 Escape로 닫힌다", async () => {
    render(<QuickCaptureDialog />);
    await act(async () => {});
    fireEvent.keyDown(document.querySelector(".quick-capture-dialog")!, {
      key: "Escape",
    });
    await act(async () => {});
    expect(useUIStore.getState().quickCaptureOpen).toBe(false);
  });
});

describe("§324-g 캡처 창 크기", () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: LOCALE });
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/z");
    useUIStore.setState({
      quickCaptureOpen: true,
      quickCaptureTaskIntent: false,
    });
  });

  it("기본 높이는 설정에 저장된 값이다", async () => {
    useSettingsStore.getState().setCaptureDialogHeight(400);
    render(<QuickCaptureDialog />);
    await act(async () => {});
    const el = document.querySelector(".quick-capture-editor") as HTMLElement;
    expect(el.style.height).toBe("400px");
  });

  it("드래그로 바꾼 높이가 설정에 남는다", async () => {
    useSettingsStore.getState().setCaptureDialogHeight(300);
    render(<QuickCaptureDialog />);
    await act(async () => {});
    const handle = document.querySelector(
      ".quick-capture-resize",
    ) as HTMLElement;
    fireEvent.mouseDown(handle, { clientY: 100 });
    fireEvent.mouseMove(window, { clientY: 180 });
    fireEvent.mouseUp(window);
    await act(async () => {});
    expect(useSettingsStore.getState().captureDialogHeight).toBe(380);
  });

  // §323 리뷰 Minor 6+7. 예전 단정은 `toBeGreaterThanOrEqual(120)`이었고, 두
  // 가지를 동시에 놓쳤다. (1) 120은 CSS의 `min-height: 12rem`(192px)보다 낮아,
  // 그 사이로 드래그하면 화면이 절대 보여줄 수 없는 높이가 설정에 남았다.
  // (2) 부등식이라, 클램프가 하나만 남아도 통과했다 — 드래그 쪽과 setter 쪽
  // 규칙이 서로를 덮어 주었기 때문에 어느 하나를 지워도 초록이었다.
  // 정확한 값으로 바꾸면 공용 클램프가 사라지는 순간(원값은 300-500 = -200)
  // 이 단정이 무너진다.
  // ‼️ §323 리뷰 E 회귀 핀. 설정 쓰기는 드래그가 끝날 때 한 번뿐이다.
  // `setCaptureDialogHeight`를 `onUp`에서 `onMove`로 옮겨도 최종 저장값은 같아
  // 기존 테스트가 전부 통과했다 — `use-capture-resize.ts`의 주석이 경고하는
  // "이동마다 쓰면 persist가 매 프레임 직렬화한다"를 지키는 것이 아무것도
  // 없었다. 값이 아니라 **횟수**를 세야 이 회귀가 잡힌다.
  it("드래그 중에는 설정에 쓰지 않는다 — mouseup에서 한 번만", async () => {
    useSettingsStore.getState().setCaptureDialogHeight(300);
    const real = useSettingsStore.getState().setCaptureDialogHeight;
    const writes = vi.fn(real);
    // 훅은 셀렉터로 스토어에서 setter를 읽으므로, 렌더 전에 갈아 끼우면
    // 실물 대신 이 spy를 쥔다(그 뒤 실물로 위임하므로 동작은 그대로다).
    useSettingsStore.setState({ setCaptureDialogHeight: writes });
    try {
      render(<QuickCaptureDialog />);
      await act(async () => {});
      const handle = document.querySelector(
        ".quick-capture-resize",
      ) as HTMLElement;

      fireEvent.mouseDown(handle, { clientY: 100 });
      fireEvent.mouseMove(window, { clientY: 140 });
      fireEvent.mouseMove(window, { clientY: 180 });
      fireEvent.mouseMove(window, { clientY: 220 });
      await act(async () => {});

      // 세 번 움직이는 동안 저장은 한 번도 일어나지 않았다.
      expect(writes).not.toHaveBeenCalled();
      expect(useSettingsStore.getState().captureDialogHeight).toBe(300);

      fireEvent.mouseUp(window);
      await act(async () => {});

      // 그리고 끝날 때 정확히 한 번. 값까지 같이 보는 이유는, 횟수만 보면
      // "아무 데서도 안 쓴다"는 반대쪽 결함이 통과하기 때문이다.
      expect(writes).toHaveBeenCalledTimes(1);
      expect(useSettingsStore.getState().captureDialogHeight).toBe(420);
    } finally {
      useSettingsStore.setState({ setCaptureDialogHeight: real });
    }
  });

  // ‼️ §323 리뷰 Minor 9 회귀 핀. 리사이즈 핸들을 잡고 다이얼로그 밖에서 손을
  // 떼면 브라우저가 mousedown/mouseup의 최근접 공통 조상 — 오버레이 — 에
  // click을 쏘고, 다이얼로그의 `stopPropagation`은 그 경로 위에 없다. 비어 있는
  // 캡처 창을 처음 만지자마자 사라지는 경로였다.
  it("리사이즈 드래그를 다이얼로그 밖에서 놓아도 창이 닫히지 않는다", async () => {
    useSettingsStore
      .getState()
      .setCaptureDialogHeight(CAPTURE_DIALOG_MIN_HEIGHT);
    render(<QuickCaptureDialog />);
    await act(async () => {});
    const handle = document.querySelector(
      ".quick-capture-resize",
    ) as HTMLElement;
    const overlayEl = document.querySelector(".quick-capture-overlay")!;

    // 누름은 다이얼로그 안(핸들), 뗌은 밖 — 그래서 click의 target이 오버레이다.
    fireEvent.mouseDown(handle, { clientY: 300 });
    fireEvent.mouseMove(window, { clientY: 420 });
    fireEvent.mouseUp(window);
    fireEvent.click(overlayEl);
    await act(async () => {});

    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
    // 드래그 자체는 정상적으로 끝났다 — 닫힘만 막고 리사이즈까지 죽이지 않았다.
    expect(useSettingsStore.getState().captureDialogHeight).toBe(
      CAPTURE_DIALOG_MIN_HEIGHT + 120,
    );
  });

  // ‼️ 단정 지점이 mouseup **앞**인 것이 이 테스트의 전부다.
  //
  // 첫 판은 mouseup 뒤에 인라인 height를 읽었고, 그래서 훅 쪽 클램프만 지워도
  // 통과했다: 드래그가 끝나면 `use-capture-resize.ts`의 동기화 effect가
  // (`if (!dragFrom) setLiveHeight(captureDialogHeight)`) 스토어의 이미 클램프된
  // 값으로 liveHeight를 덮어써서, 화면과 상태가 어긋났던 사실 자체가 지워진다.
  // 어긋남은 드래그 도중에만 보인다 — 사용자가 그것을 보는 시점도 바로 그때다.
  it("드래그 중 화면 높이는 CSS가 보여줄 수 있는 범위를 벗어나지 않는다", async () => {
    useSettingsStore.getState().setCaptureDialogHeight(300);
    render(<QuickCaptureDialog />);
    await act(async () => {});
    const handle = document.querySelector(
      ".quick-capture-resize",
    ) as HTMLElement;
    const editor = document.querySelector(
      ".quick-capture-editor",
    ) as HTMLElement;

    fireEvent.mouseDown(handle, { clientY: 500 });

    // 바닥 아래로 한참 끌어올린다(원값 -200px).
    fireEvent.mouseMove(window, { clientY: 0 });
    await act(async () => {});
    expect(editor.style.height).toBe(`${CAPTURE_DIALOG_MIN_HEIGHT}px`);

    // 같은 드래그에서 천장 위로 한참 끌어내린다(원값 2300px). 훅에는 원래
    // 상한이 아예 없어서 상자가 마음껏 커졌다가 mouseup에서 되튕겼다.
    fireEvent.mouseMove(window, { clientY: 2500 });
    await act(async () => {});
    expect(editor.style.height).toBe(`${CAPTURE_DIALOG_MAX_HEIGHT}px`);

    fireEvent.mouseUp(window);
    await act(async () => {});
    expect(useSettingsStore.getState().captureDialogHeight).toBe(
      CAPTURE_DIALOG_MAX_HEIGHT,
    );
  });

  it("저장되는 높이의 하한은 CSS가 실제로 보여줄 수 있는 최솟값이다", async () => {
    useSettingsStore.getState().setCaptureDialogHeight(300);
    render(<QuickCaptureDialog />);
    await act(async () => {});
    const handle = document.querySelector(
      ".quick-capture-resize",
    ) as HTMLElement;
    fireEvent.mouseDown(handle, { clientY: 500 });
    fireEvent.mouseMove(window, { clientY: 0 });
    fireEvent.mouseUp(window);
    await act(async () => {});
    expect(useSettingsStore.getState().captureDialogHeight).toBe(
      CAPTURE_DIALOG_MIN_HEIGHT,
    );
  });
});

// §320/§324-a 태그가 주소다 — 캡처가 태그가 지목한 노트의 `## Captures` 절로 가고,
// 어디에 갔는지 사용자가 안다. 세 갈래 쓰기 경로 자체는 서비스의 테스트가 본다;
// 여기서 보는 것은 **분기**다: 대상이 있으면 append, 없으면 inbox, 태스크 모드면 둘 다
// 아니다.
describe("QuickCaptureDialog — 태그가 지목한 노트에 붙인다 (§320, §324-a)", () => {
  const NOTE_PATH = "/vault/zettel/notes/202609021015 영감노트.md";
  const NOTE_ENTRY = {
    isDir: false,
    modifiedAt: 1,
    name: "202609021015 영감노트.md",
    path: NOTE_PATH,
    size: 0,
  };

  const taskToggle = () =>
    screen.getByRole("checkbox", {
      name: t("journal.capture.taskMode.label", LOCALE),
    });
  const setTags = (value: string) =>
    fireEvent.change(screen.getByPlaceholderText(tagsPlaceholder), {
      target: { value },
    });

  /**
   * 대상 스캔이 **상태로 커밋될 때까지** 기다린다.
   *
   * 이 대기가 없으면 아래 "붙이지 않았다"류 단정이 "아직 못 읽었다"로도 통과한다 —
   * 이 describe가 가장 경계해야 할 거짓 초록이다. 신호로 `readFile(NOTE_PATH)`를 쓰는
   * 것이 가능한 이유는 아래 `listDir` 목이 노트를 **`notes/`에서만** 돌려주기 때문이다:
   * Zettel 루트를 훑는 태그 인덱스(`use-capture-tags`)는 이 경로를 절대 읽지 않으므로,
   * 이 호출은 대상 스캔에서만 나온다. 이어지는 `act`가 `Promise.all` → `setNotes`
   * 커밋까지 흘려보낸다.
   */
  async function waitForTargetsLoaded(): Promise<void> {
    await vi.waitFor(() => expect(readFile).toHaveBeenCalledWith(NOTE_PATH));
    await act(async () => {});
  }

  /** 대상이 하나 잡힌 상태로 저장까지 — 여러 테스트가 같은 다섯 줄을 반복한다. */
  async function saveWith(tag: string, body = "떠오른 생각"): Promise<void> {
    await waitForTargetsLoaded();
    setCaptureBody(body);
    setTags(tag);
    fireEvent.click(saveButton());
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      locale: LOCALE,
      tasksCaptureFile: "tasks/inbox.md",
    });
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
    // ‼️ `showToast`까지 직접 되돌린다. 앞선 §324-e describe의 `afterEach`가 이미 그렇게
    // 하지만, 그것에 기대면 이 describe의 토스트 단정이 **파일 안의 실행 순서**에 매달린다
    // — 위쪽 describe를 지우거나 `.only`로 이 describe만 돌리는 순간 다섯 개가 조용히
    // 거짓 초록이 된다. 자기가 쓰는 배선은 자기가 세운다.
    useUIStore.setState({
      quickCaptureOpen: true,
      quickCaptureTaskIntent: false,
      showToast: REAL_SHOW_TOAST,
      toast: null,
    });
    vi.mocked(captureTask).mockResolvedValue("- [ ] x");
    vi.mocked(captureFleeting).mockResolvedValue({
      path: "/vault/zettel/inbox/x.md",
    });
    vi.mocked(appendCaptureToNotes).mockResolvedValue([
      { path: NOTE_PATH, title: "영감노트" },
    ]);
    vi.mocked(listDir).mockImplementation(async (path: string) =>
      path === "/vault/zettel/notes" ? [NOTE_ENTRY] : [],
    );
    vi.mocked(readFile).mockResolvedValue("");
  });

  afterEach(() => {
    // `clearAllMocks`는 호출 기록만 지우고 **구현은 남긴다** — 되돌리지 않으면 다음
    // describe들이 갑자기 노트 하나가 있는 Zettel 공간을 보게 된다.
    vi.mocked(listDir).mockResolvedValue([]);
    vi.mocked(readFile).mockResolvedValue("");
  });

  /**
   * `notes/` 스캔을 테스트가 붙잡아 둔다 — `release()`를 부를 때까지 `loading`이 참이다.
   * 태그 인덱스가 훑는 Zettel 루트는 그대로 비워 둬서, 붙잡히는 것이 대상 스캔뿐이게 한다.
   */
  function holdTargetScan(): (entries: (typeof NOTE_ENTRY)[]) => void {
    let release!: (entries: (typeof NOTE_ENTRY)[]) => void;
    vi.mocked(listDir).mockImplementation(async (path: string) =>
      path === "/vault/zettel/notes"
        ? new Promise((resolve) => {
            release = resolve;
          })
        : [],
    );
    return (entries) => release(entries);
  }

  // ‼️ 스캔이 끝나기 전에 저장하면 대상이 아직 **비어 있다.** 그대로 두면 캡처가
  // `inbox/`로 가고 토스트가 "#영감노트와 일치하는 노트가 없습니다"라고 말한다 — 그것은
  // 거짓이다. §324-a가 없애려는 실패(어디로 갔는지 잘못 아는 것)를 이 경로가 새로
  // 만들어 낸다.
  //
  // ‼️ 저장을 **키보드로** 건다. `handleKeyDown`은 `handleSave()`를 직접 부르므로 버튼의
  // `disabled`를 아예 거치지 않는다 — 버튼만 막는 수정은 이 테스트를 통과하지 못한다.
  it("refuses to save through ⌘↩ while the target scan is still in flight", async () => {
    const release = holdTargetScan();
    render(<QuickCaptureDialog />);
    setCaptureBody("떠오른 생각");
    setTags("#영감노트");
    fireEvent.keyDown(captureEditable(), { ctrlKey: true, key: "Enter" });

    await screen.findByText(t("journal.capture.error.scanning", LOCALE));
    expect(appendCaptureToNotes).not.toHaveBeenCalled();
    // 그리고 `inbox/`로도 새지 않았다 — 거절이지 조용한 폴백이 아니다.
    expect(captureFleeting).not.toHaveBeenCalled();
    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
    expect(captureEditable().textContent).toBe("떠오른 생각");

    // 스캔이 끝나면 **같은 입력이 그대로** 통과한다 — 위 단정은 "영영 저장 못 한다"가
    // 아니고, 이 절반이 없으면 그 둘을 구분하지 못한다.
    await act(async () => {
      release([NOTE_ENTRY]);
    });
    await waitForTargetsLoaded();
    fireEvent.keyDown(captureEditable(), { ctrlKey: true, key: "Enter" });
    await vi.waitFor(() => expect(appendCaptureToNotes).toHaveBeenCalled());
  });

  it("disables Save while the target scan is in flight, and re-enables it after", async () => {
    const release = holdTargetScan();
    render(<QuickCaptureDialog />);
    setCaptureBody("떠오른 생각");
    setTags("#영감노트");

    expect(saveButton()).toBeDisabled();

    await act(async () => {
      release([NOTE_ENTRY]);
    });
    await waitForTargetsLoaded();
    expect(saveButton()).not.toBeDisabled();
  });

  // §324-c 미리보기와 저장 버튼은 같은 `scanPending`/`captureTargets` 값을 쓴다 — 스캔이
  // 끝나기 전에 대상을 말하면 그 값이 아직 비어 있어 "일치하는 노트 없음"이 된다.
  it("says nothing about the target while the scan is in flight, then names it once resolved", async () => {
    const release = holdTargetScan();
    render(<QuickCaptureDialog />);
    setTags("#영감노트");

    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => {
      release([NOTE_ENTRY]);
    });
    await waitForTargetsLoaded();
    expect(screen.getByRole("status")).toHaveTextContent("영감노트");
  });

  // ‼️ 태스크는 한 줄이고 노트에 붙지 않는다 — 대상을 말하면 거짓 약속이 된다.
  it("hides the target preview in task mode", async () => {
    render(<QuickCaptureDialog />);
    await waitForTargetsLoaded();
    setTags("#영감노트");
    expect(screen.getByRole("status")).toHaveTextContent("영감노트");

    fireEvent.click(taskToggle());

    expect(screen.queryByRole("status")).toBeNull();
  });

  // 태그를 안 적었으면 기다릴 이유가 없다 — 대상이 무엇이든 캡처는 `inbox/`로 가고
  // 토스트도 뜨지 않으므로 스캔 결과가 답을 바꾸지 못한다. 그런데도 막으면 §99의 가장
  // 흔한 경로가 열릴 때마다 저장 버튼이 잠깐 죽는다.
  it("does not block a no-tag save on the scan", async () => {
    holdTargetScan();
    render(<QuickCaptureDialog />);
    setCaptureBody("떠오른 생각");

    expect(saveButton()).not.toBeDisabled();
    fireEvent.click(saveButton());
    await vi.waitFor(() => expect(captureFleeting).toHaveBeenCalled());
  });

  /**
   * `fakeDisk`의 §320판 — 쓴 파일을 되비추면서 `notes/` 목록도 계속 답한다. 대상 스캔이
   * 그 목록을 읽어야 하므로 순수한 write 기록용 대역으로는 이 describe가 성립하지 않는다.
   */
  function fakeDiskWithNote(): Map<string, unknown> {
    const disk = new Map<string, unknown>();
    vi.mocked(writeBinaryFile).mockImplementation(async (path, data) => {
      disk.set(path, data);
    });
    vi.mocked(listDir).mockImplementation(async (dir) => {
      const written = [...disk.keys()]
        .filter((p) => p.slice(0, p.lastIndexOf("/")) === dir)
        .map((p) => ({
          isDir: false,
          modifiedAt: 0,
          name: p.slice(p.lastIndexOf("/") + 1),
          path: p,
          size: 0,
        }));
      return dir === "/vault/zettel/notes" ? [NOTE_ENTRY, ...written] : written;
    });
    return disk;
  }

  // ‼️ 미디어는 **항목이 붙는 노트 옆**에 쓰여야 한다.
  //
  // 상대참조는 열려 있는 파일의 디렉터리를 기준으로 풀린다(`active-file-dir.ts`). 그래서
  // 파일을 `inbox/assets/`에 쓰고 항목을 `notes/…`에 붙이면, 허브 노트는
  // `notes/assets/…`를 찾다가 못 찾고 이미지는 영영 깨진 채로 남으며 실제 파일은
  // `inbox/assets/`에 고아로 쌓인다. §324-e는 "캡처가 곧 그 파일이 된다"는 전제로
  // 목적지를 골랐고, §320이 그 전제를 깼다.
  it("writes pasted media beside the target note, not into the inbox", async () => {
    fakeDiskWithNote();
    render(<QuickCaptureDialog />);
    await waitForTargetsLoaded();
    pasteImageInCapture("pearl.png");
    await waitForCaptureImages(1);
    setTags("#영감노트");

    await act(async () => {
      fireEvent.click(saveButton());
    });

    await vi.waitFor(() => expect(appendCaptureToNotes).toHaveBeenCalled());
    expect(createDir).toHaveBeenCalledWith("/vault/zettel/notes/assets");
    expect(writeBinaryFile).toHaveBeenCalledWith(
      "/vault/zettel/notes/assets/pearl.png",
      expect.any(Array),
    );
    // 그리고 본문에 남은 상대참조가 **그 자리에서** 실제로 풀린다.
    const { body } = vi.mocked(appendCaptureToNotes).mock.calls[0][0];
    expect(body).toContain("![pearl.png](assets/pearl.png)");
    expect(body).not.toContain("data:");
  });

  // 태그가 아무것도 못 맞히면 캡처는 `inbox/`의 파일이 되므로 미디어도 거기 있어야
  // 한다 — §324-e의 원래 동작. 위 테스트가 목적지를 **언제나** 노트 옆으로 옮기는
  // 수정으로도 통과하지 않게 막는 짝이다.
  it("still writes media into the inbox when no tag matches", async () => {
    fakeDiskWithNote();
    render(<QuickCaptureDialog />);
    await waitForTargetsLoaded();
    pasteImageInCapture("pearl.png");
    await waitForCaptureImages(1);
    setTags("#영감노드");

    await act(async () => {
      fireEvent.click(saveButton());
    });

    await vi.waitFor(() => expect(captureFleeting).toHaveBeenCalled());
    expect(writeBinaryFile).toHaveBeenCalledWith(
      "/vault/zettel/inbox/assets/pearl.png",
      expect.any(Array),
    );
  });

  // ‼️ 회귀. 태스크 모드로 **토글**하면 대상 훅의 `open`이 true→false가 되는데, 그 훅의
  // 리셋은 false→**true**에서만 돈다 — 토글 직전에 풀려 있던 `targets`가 그대로 남는다.
  // 그것을 읽는 미디어 목적지는 태스크가 절대 닿지 않을 노트 옆에 이미지를 쓰고,
  // `tasks/inbox.md`의 `assets/pearl.png`는 `tasks/assets/`를 찾다가 깨진다. F1과 같은
  // 결함이 방향만 반대다.
  //
  // 이 상태는 이미 있는 두 테스트 **사이**에 있다: 하나는 대상이 애초에 없고, 다른 하나는
  // **열자마자** 태스크 모드다. "풀렸다가 태스크가 된" 중간 상태는 어느 쪽도 보지 못한다.
  it("does not put a task's media beside a note when task mode is toggled on after targets resolve", async () => {
    useSettingsStore.setState({
      tasksCaptureFile: "inbox.md",
      tasksHome: "/vault/tasks-home",
    });
    fakeDiskWithNote();
    render(<QuickCaptureDialog />);
    await waitForTargetsLoaded();
    setTags("#영감노트");
    pasteImageInCapture("pearl.png");
    await waitForCaptureImages(1);
    fireEvent.click(taskToggle());

    await act(async () => {
      fireEvent.click(saveButton());
    });

    await vi.waitFor(() => expect(captureTask).toHaveBeenCalled());
    expect(writeBinaryFile).toHaveBeenCalledWith(
      "/vault/tasks-home/tasks/assets/pearl.png",
      expect.any(Array),
    );
    expect(writeBinaryFile).not.toHaveBeenCalledWith(
      expect.stringContaining("/vault/zettel/notes/"),
      expect.anything(),
    );
  });

  // 태스크 모드는 대상을 쓰지 않는다. §313 전역 캡처는 **태스크 모드로 열리므로**, 그런
  // 캡처 한 번마다 `notes/` 아래 노트를 전부 읽는 팬아웃이 통째로 낭비된다.
  //
  // ‼️ 단정 대상이 `listDir`이 아니라 노트 **본문 읽기**인 이유: 열자마자 태스크 모드가
  // 켜지는 순서상(대상 훅의 effect가 `resetTaskMode`의 effect보다 먼저 돈다) 디렉터리
  // 목록 한 번은 이미 출발한 뒤다. 값을 치르는 것은 그 뒤의 N개 `readFile`이고, 취소된
  // 스캔은 거기 도달하지 않아야 한다.
  it("does not read the note files when the dialog opens straight into task mode", async () => {
    act(() => useUIStore.setState({ quickCaptureOpen: false }));
    vi.mocked(readFile).mockClear();
    act(() =>
      useUIStore.setState({
        quickCaptureOpen: true,
        quickCaptureTaskIntent: true,
      }),
    );

    render(<QuickCaptureDialog />);
    await act(async () => {});
    await act(async () => {});

    expect(taskToggle()).toBeChecked();
    expect(readFile).not.toHaveBeenCalledWith(NOTE_PATH);
  });

  // ‼️ 스캔 **실패**는 "일치하는 노트 없음"과 다른 사실이다. 예전에는 `listDir`의 거절을
  // `[]`로 삼켜 둘이 같은 모양이 됐고, 그러면 멀쩡한 `#영감노트`가 IPC 한 번 흔들린 것
  // 때문에 `inbox/`로 가면서 토스트가 **사용자의 태그를 탓했다** — 이 브랜치가 닫으려는
  // 바로 그 블랙홀로, 원인이 뒤바뀐 채.
  //
  // 짝이 되는 반대 경우("스캔은 성공했고 정말로 일치가 없다")는 위 "falls back to the
  // inbox…"가 본다. 둘이 함께 있어야 이 단정이 "언제나 거절한다"로 통과하지 않는다.
  it("blames the failed scan, not the tag, when the notes folder cannot be read", async () => {
    vi.mocked(listDir).mockImplementation(async (path: string) => {
      if (path === "/vault/zettel/notes") throw new Error("EIO");
      return [];
    });
    render(<QuickCaptureDialog />);
    setCaptureBody("떠오른 생각");
    setTags("#영감노트");
    await vi.waitFor(() => expect(saveButton()).not.toBeDisabled());
    fireEvent.click(saveButton());

    await screen.findByText(t("journal.capture.error.scanFailed", LOCALE));
    // 어디로도 새지 않았고, 태그를 탓하는 토스트도 뜨지 않았다.
    expect(captureFleeting).not.toHaveBeenCalled();
    expect(appendCaptureToNotes).not.toHaveBeenCalled();
    expect(useUIStore.getState().toast).toBeNull();
    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
  });

  // §324-a 토스트의 절반 — 미리보기가 저장 **전에** 말하는 것을 토스트는 저장 **후에**
  // 말한다. 한쪽만 말하면 저장을 누르고 창을 닫은 사용자는 영영 알지 못한다.
  it("names the tag that matched nothing in the success toast", async () => {
    render(<QuickCaptureDialog />);
    await saveWith("#영감노트 #Linsk");

    await vi.waitFor(() => expect(useUIStore.getState().toast).not.toBeNull());
    const { toast } = useUIStore.getState();
    expect(toast!.message).toContain("영감노트");
    expect(toast!.message).toContain("Linsk");
  });

  // §326 커버리지 — §323의 값어치가 실제로 노트까지 닿는지. 지금까지 append 경로의
  // 다이얼로그 테스트는 전부 plain 본문을 썼고, 서비스 테스트도 plain 문자열을 넘겼다.
  // 그래서 "WYSIWYG로 쓴 서식이 허브 노트에 마크다운으로 도착한다"를 보이는 테스트가
  // 한 곳도 없었다.
  it("carries formatted capture content into the append", async () => {
    render(<QuickCaptureDialog />);
    await waitForTargetsLoaded();
    await act(async () => {
      (
        document.querySelector(".quick-capture-editor") as HTMLElement & {
          _editor?: { commands: { setContent: (v: string) => void } };
        }
      )._editor?.commands.setContent(
        "<p><strong>굵게</strong> 보통</p><ul><li><p>항목</p></li></ul>",
      );
    });
    setTags("#영감노트");
    fireEvent.click(saveButton());

    await vi.waitFor(() => expect(appendCaptureToNotes).toHaveBeenCalled());
    const { body } = vi.mocked(appendCaptureToNotes).mock.calls[0][0];
    expect(body).toContain("**굵게**");
    expect(body).toContain("- 항목");
    // HTML이 그대로 새지 않았다 — 디스크에 쓰이는 것은 마크다운이다.
    expect(body).not.toContain("<strong>");
  });

  it("appends to the matched note instead of creating an inbox file", async () => {
    render(<QuickCaptureDialog />);
    await saveWith("#영감노트");

    await vi.waitFor(() => {
      expect(appendCaptureToNotes).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "떠오른 생각",
          targets: [
            expect.objectContaining({ path: NOTE_PATH, title: "영감노트" }),
          ],
        }),
      );
    });
    expect(captureFleeting).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(useUIStore.getState().quickCaptureOpen).toBe(false),
    );
  });

  it("falls back to the inbox when no note matches, and says so differently", async () => {
    render(<QuickCaptureDialog />);
    await saveWith("#영감노드"); // 오타 — 어떤 노트도 지목하지 못한다

    await vi.waitFor(() => expect(captureFleeting).toHaveBeenCalled());
    expect(appendCaptureToNotes).not.toHaveBeenCalled();
    const { toast } = useUIStore.getState();
    expect(toast?.type).toBe("warning");
    expect(toast?.message).toContain("영감노드");
  });

  // ‼️ 폴백 토스트가 태그를 **하나만** 말하면, 두 개를 잘못 적은 사용자는 하나를 고치고
  // 나머지 하나가 여전히 아무 데도 닿지 않는다는 것을 모른 채 다음 캡처를 한다.
  // §324-a가 보여 주려는 것은 "무엇이 닿지 않았나" 전부다.
  it("names every tag that matched nothing in the inbox fallback", async () => {
    render(<QuickCaptureDialog />);
    await saveWith("#영감노드 #Wrong");

    await vi.waitFor(() => expect(captureFleeting).toHaveBeenCalled());
    const { toast } = useUIStore.getState();
    expect(toast?.type).toBe("warning");
    expect(toast?.message).toContain("영감노드");
    expect(toast?.message).toContain("Wrong");
  });

  // 태그를 아예 안 적었으면 대상을 **지목하지 않은** 것이다. 그것은 실패가 아니므로
  // 경고를 띄우면 §99의 정상 동작이 매번 문제처럼 보인다.
  //
  // ‼️ "토스트가 null이다"만 보면 안 된다 — 토스트 배선이 통째로 끊겨 있어도 그 단정은
  // 통과한다. 이 파일에서 실제로 그랬다(§324-e describe가 `showToast`를 갈아 끼운 채
  // 되돌리지 않아 이 describe의 다섯 테스트가 조용히 죽었고, 이 테스트만 초록으로 남아
  // 아무것도 알려 주지 않았다). 그래서 스파이를 세워 0회를 단정하고, **같은 스파이가**
  // 토스트를 띄워야 하는 경로에서는 실제로 불린다는 것을 같은 테스트 안에서 보인다.
  it("says nothing about the inbox when no tag was typed at all", async () => {
    const showToast = vi.fn();
    useUIStore.setState({ showToast });

    render(<QuickCaptureDialog />);
    await waitForTargetsLoaded();
    setCaptureBody("떠오른 생각");
    fireEvent.click(saveButton());

    await vi.waitFor(() => expect(captureFleeting).toHaveBeenCalled());
    expect(showToast).not.toHaveBeenCalled();

    // positive control — 오타 태그를 적은 저장은 **같은 스파이**를 부른다. 이 절반이
    // 없으면 위의 0회는 "배선이 죽었다"와 구분되지 않는다.
    vi.mocked(readFile).mockClear();
    act(() => {
      useUIStore.setState({ quickCaptureOpen: true });
    });
    await waitForTargetsLoaded();
    setCaptureBody("떠오른 생각");
    setTags("#영감노드");
    fireEvent.click(saveButton());

    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());
  });

  // ‼️ 매칭 실패가 성공과 **같은 모양으로** 보이면 안 된다(§324-a). 같으면 `#영감노드`
  // 같은 오타가 성공처럼 읽히고 캡처가 계속 `inbox/`에 쌓인다.
  //
  // "두 문자열이 서로 다르다"는 단정으로는 아무것도 잡지 못한다 — 두 저장이 **다른
  // 태그**로 일어나므로 문구 템플릿이 완전히 같아도 결과 문자열은 달라진다(실제로
  // `inboxFallback`을 `appended.one`과 같은 템플릿으로 바꾼 뮤테이션이 그렇게 살아남았다).
  // 그래서 (a) 실패 토스트가 성공 템플릿에 **자기 태그를 끼운 것**이 아니고, (b) 종류부터
  // 다르다는 것을 본다.
  it("uses a different shape for a match than for the inbox fallback", async () => {
    const toastAfterSaving = async (tag: string): Promise<ToastState> => {
      useUIStore.setState({ quickCaptureOpen: true, toast: null });
      vi.mocked(readFile).mockClear();
      const view = render(<QuickCaptureDialog />);
      await saveWith(tag);
      await vi.waitFor(() =>
        expect(useUIStore.getState().toast).not.toBeNull(),
      );
      const toast = useUIStore.getState().toast!;
      view.unmount();
      return toast;
    };

    const matched = await toastAfterSaving("#영감노트");
    const missed = await toastAfterSaving("#영감노드");

    // 종류부터 다르다 — 훑어보는 눈이 잡는 것은 이것이다.
    expect(missed.type).not.toBe(matched.type);
    // 그리고 **틀** 자체가 다르다. 두 문구에 **같은 값**을 끼워 비교하는 이유: 실제
    // 메시지는 한쪽이 `#`를 붙인 태그를, 다른 쪽이 노트 제목을 담으므로, 템플릿이 완전히
    // 같아도 결과 문자열은 달라진다. 실제로 `inboxFallback`을 `appended.one`과 같은
    // 템플릿으로 바꾼 뮤테이션이 값 비교만으로는 두 번 살아남았다.
    expect(t("journal.capture.inboxFallback", LOCALE, { tags: "X" })).not.toBe(
      t("journal.capture.appended.one", LOCALE, { title: "X" }),
    );
  });

  it("offers Open on the success toast and opens the note", async () => {
    vi.mocked(readFile).mockImplementation(async (path: string) =>
      path === NOTE_PATH ? "# 영감노트\n" : "",
    );
    render(<QuickCaptureDialog />);
    await saveWith("#영감노트");

    await vi.waitFor(() =>
      expect(useUIStore.getState().toast?.action).toBeDefined(),
    );
    const { toast } = useUIStore.getState();
    expect(toast!.message).toContain("영감노트");
    toast!.action!.onClick();

    // 내용은 **디스크에서 다시 읽은 것**이다 — 방금 append된 항목이 들어 있는 판본.
    await vi.waitFor(() =>
      expect(openFileInTab).toHaveBeenCalledWith(NOTE_PATH, "# 영감노트\n"),
    );
  });

  // 대상이 둘 이상이면 개수만 말하고 행동은 주지 않는다 — 어느 것을 열지 정할 근거가 없다.
  it("names the count and offers no action when several notes took the capture", async () => {
    vi.mocked(appendCaptureToNotes).mockResolvedValue([
      { path: NOTE_PATH, title: "영감노트" },
      { path: "/vault/zettel/notes/기록.md", title: "기록" },
    ]);
    render(<QuickCaptureDialog />);
    await saveWith("#영감노트");

    await vi.waitFor(() => expect(useUIStore.getState().toast).not.toBeNull());
    const { toast } = useUIStore.getState();
    expect(toast!.message).toBe(
      t("journal.capture.appended.many", LOCALE, { count: "2" }),
    );
    expect(toast!.action).toBeUndefined();
  });

  // ‼️ 실패하면 다이얼로그가 **열린 채로** 남는다 — 본문은 다른 어디에도 없다.
  it("keeps the dialog open and names the blocking note when a tab blocks the append", async () => {
    vi.mocked(appendCaptureToNotes).mockRejectedValue(
      new CaptureAppendError("dirtyTab", "영감노트", [], "unsaved tab"),
    );
    render(<QuickCaptureDialog />);
    await saveWith("#영감노트");

    await screen.findByText(
      t("journal.capture.error.appendDirtyTab", LOCALE, { title: "영감노트" }),
    );
    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
    expect(captureEditable().textContent).toBe("떠오른 생각");
  });

  // 첫 대상은 **이미 쓰였다**. 감추면 사용자가 다시 눌러 그 노트에 중복을 만든다.
  it("still reports the note that already landed when a later target fails", async () => {
    vi.mocked(appendCaptureToNotes).mockRejectedValue(
      new CaptureAppendError(
        "writeFailed",
        "기록",
        [{ path: NOTE_PATH, title: "영감노트" }],
        "disk full",
      ),
    );
    render(<QuickCaptureDialog />);
    await saveWith("#영감노트");

    // 막힌 노트의 이름은 오류 문구가 말하고…
    await screen.findByText(
      t("journal.capture.error.append", LOCALE, { title: "기록" }),
    );
    // …이미 들어간 노트의 이름은 토스트가 말한다.
    expect(useUIStore.getState().toast?.message).toBe(
      t("journal.capture.appended.one", LOCALE, { title: "영감노트" }),
    );
    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
  });

  // ‼️ 태스크 모드는 이 경로를 타지 않는다 — 태스크는 수집함의 한 줄이고 노트가 아니다.
  it("does not append to a note in task mode", async () => {
    render(<QuickCaptureDialog />);
    await waitForTargetsLoaded();
    fireEvent.click(taskToggle());
    setCaptureBody("떠오른 생각");
    setTags("#영감노트");
    fireEvent.click(saveButton());

    await vi.waitFor(() => expect(captureTask).toHaveBeenCalled());
    expect(appendCaptureToNotes).not.toHaveBeenCalled();
  });

  // §324-f Source가 URL이면 append된 문서에서 클릭된다 — 본문에 접지 않고 그대로 넘긴다.
  it("passes the raw source through so it becomes a link", async () => {
    render(<QuickCaptureDialog />);
    await waitForTargetsLoaded();
    setCaptureBody("떠오른 생각");
    setTags("#영감노트");
    fireEvent.change(screen.getByPlaceholderText(sourcePlaceholder), {
      target: { value: "코너 https://example.com/m" },
    });
    fireEvent.click(saveButton());

    await vi.waitFor(() => {
      expect(appendCaptureToNotes).toHaveBeenCalledWith(
        expect.objectContaining({ source: "코너 https://example.com/m" }),
      );
    });
    // 그리고 본문에 `Source: `로 접히지 **않았다** — 그것은 inbox 갈래의 포맷이다.
    expect(vi.mocked(appendCaptureToNotes).mock.calls[0][0].body).not.toContain(
      "Source:",
    );
  });

  // ‼️ 라우터가 판정하는 것은 대상 노트를 탭에 열어 둔 **메인 편집기**다. 캡처 창의
  // 편집기(`capture.editor`)를 넘기면 라우터가 "그 파일은 아무 데도 열려 있지 않다"고
  // 판정해, 저장하지 않은 탭이 있는 노트를 디스크에서 덮어쓴다.
  it("hands the append the main editor, not the capture dialog's own", async () => {
    const mainEditor = { __probe: "main-editor" } as unknown as Editor;
    render(
      <EditorProvider value={mainEditor}>
        <QuickCaptureDialog />
      </EditorProvider>,
    );
    await saveWith("#영감노트");

    await vi.waitFor(() => {
      expect(appendCaptureToNotes).toHaveBeenCalledWith(
        expect.objectContaining({ editor: mainEditor }),
      );
    });
  });
});
