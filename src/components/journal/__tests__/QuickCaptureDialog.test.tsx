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

import { t } from "../../../i18n";
import { createDir, listDir, writeBinaryFile } from "../../../ipc/invoke";
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
