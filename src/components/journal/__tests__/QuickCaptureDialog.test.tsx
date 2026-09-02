import type { Editor } from "@tiptap/react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Slice } from "@tiptap/pm/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  appendTaskLine: vi.fn(),
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
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
import { CaptureError, captureTask } from "../../../services/task-capture";
import { captureFleeting } from "../../../services/zettelkasten-service";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { CAPTURE_DIALOG_MIN_HEIGHT } from "../../../stores/settings/journal-settings";
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
function pasteImageInCapture(name = "shot.png"): void {
  const editor = (
    document.querySelector(".quick-capture-editor") as HTMLElement & {
      _editor?: Editor;
    }
  )._editor!;
  const event = {
    clipboardData: {
      files: [new File(["x"], name, { type: "image/png" })],
      getData: () => "",
    },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
  act(() => {
    editor.view.someProp("handlePaste", (f) =>
      f(editor.view, event, Slice.empty),
    );
  });
}

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

// §324-e round 2 — review Critical: the round-1 fix only covered "zettel
// configured, task mode off". These two pin the cases that slipped through:
// task mode (which ignores the Zettel space entirely, tasks-home.ts) and the
// default install (zettel unconfigured, which round 1's own tests never hit
// because they hard-coded `zettelkastenEnabled: true`).
describe("QuickCaptureDialog — §324-e 이미지 목적지", () => {
  const taskToggle = () =>
    screen.getByRole("checkbox", {
      name: t("journal.capture.taskMode.label", LOCALE),
    });
  const originalEditorState = useEditorStore.getState();
  const originalSettingsState = useSettingsStore.getState();
  const originalFileState = useFileStore.getState();

  beforeEach(() => {
    vi.clearAllMocks();
    savePhotoToAssets.mockClear();
    useSettingsStore.setState({ locale: LOCALE });
    useUIStore.setState({ quickCaptureOpen: true });
  });

  afterEach(() => {
    useEditorStore.setState(originalEditorState, true);
    useSettingsStore.setState(originalSettingsState, true);
    useFileStore.setState(originalFileState, true);
  });

  it("task mode ON + zettel configured — resolves under the tasks capture directory, not the zettel inbox", async () => {
    useSettingsStore.setState({
      tasksHome: "/vault/tasks-home",
      tasksCaptureFile: "inbox.md",
    });
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");

    render(<QuickCaptureDialog />);
    fireEvent.click(taskToggle());
    pasteImageInCapture();

    await vi.waitFor(() => {
      expect(savePhotoToAssets).toHaveBeenCalled();
    });
    expect(savePhotoToAssets).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "shot.png",
      expect.anything(),
      expect.anything(),
      "/vault/tasks-home/tasks/inbox.md",
    );
  });

  it("zettel unconfigured + task mode off — does not fall back to the main window's active tab", async () => {
    useSettingsStore.getState().setZettelkastenEnabled(false);
    useSettingsStore.getState().setZettelkastenDirectory("");
    useFileStore.getState().setRootPath("/vault");
    // §324-e round 1's exact repro state: a document tab open in the main
    // window that has nothing to do with capture — made to look like a
    // journal entry (`journalDirectory` prefix match) specifically so that,
    // if the round-1 "resolver returned null → fall through" logic were
    // still in place, `getJournalContext` would call this a journal write
    // and actually save next to it. A non-journal-looking tab wouldn't
    // distinguish round 1 from round 2 here (both would land on the data-URL
    // branch anyway) — this is the one shape where the two disagree.
    useSettingsStore.setState({ journalDirectory: "/vault/notes" });
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [{ id: "t1", filePath: "/vault/notes/unrelated.md" }],
    } as never);

    render(<QuickCaptureDialog />);
    pasteImageInCapture();

    await vi.waitFor(() => {
      const img = document.querySelector(".quick-capture-editor img");
      expect(img).not.toBeNull();
    });
    expect(savePhotoToAssets).not.toHaveBeenCalled();
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

  it("높이 하한은 CSS가 실제로 보여줄 수 있는 최솟값이다", async () => {
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
    // 드래그 중 화면에 그려지는 값도 같은 규칙을 지났다 — 저장된 값과 인라인
    // height가 어긋나면 그것이 이 결함의 원래 모양이다.
    const editor = document.querySelector(
      ".quick-capture-editor",
    ) as HTMLElement;
    expect(editor.style.height).toBe(`${CAPTURE_DIALOG_MIN_HEIGHT}px`);
  });
});
