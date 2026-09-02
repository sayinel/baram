import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { t } from "../../../i18n";
import { CaptureError, captureTask } from "../../../services/task-capture";
import { captureFleeting } from "../../../services/zettelkasten-service";
import { useFileStore } from "../../../stores/file/file";
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
    fireEvent.click(overlay());

    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
  });

  it("closes on outside click when nothing is typed", () => {
    render(<QuickCaptureDialog />);
    fireEvent.click(overlay());

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

  // ‼️ 한글 IME 회귀 핀. 조합 중 Mod+Enter는 음절을 확정할 뿐 저장이 아니다.
  it("IME 조합 중 Mod+Enter는 저장하지 않는다", async () => {
    render(<QuickCaptureDialog />);
    await act(async () => {});
    const editable = document.querySelector(
      ".quick-capture-editor [contenteditable]",
    ) as HTMLElement;
    fireEvent.keyDown(editable, {
      key: "Enter",
      metaKey: true,
      ctrlKey: true,
      isComposing: true,
    });
    await act(async () => {});
    expect(captureFleeting).not.toHaveBeenCalled();
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
