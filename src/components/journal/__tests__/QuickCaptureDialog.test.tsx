import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
}));
vi.mock("../../../services/zettelkasten-service", () => ({
  captureFleeting: vi.fn().mockResolvedValue({ path: "/z/inbox/x.md" }),
}));

import { t } from "../../../i18n";
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
const bodyPlaceholder = t("journal.capture.body.placeholder", LOCALE);
const sourcePlaceholder = t("journal.capture.source.placeholder", LOCALE);
const tagsPlaceholder = t("journal.capture.tags.placeholder", LOCALE);
const SAVE_PREFIX = t("journal.capture.save", LOCALE).split("{")[0].trim();
// A predicate, not a RegExp: the English label is "Save (…)" and that "(" is an unterminated
// group once it is interpolated into a pattern.
const saveButton = () =>
  screen.getByRole("button", {
    name: (name: string) => name.startsWith(SAVE_PREFIX),
  });

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
    fireEvent.change(screen.getByPlaceholderText(bodyPlaceholder), {
      target: { value: "hello" },
    });

    expect(screen.queryByText(noSpaceHint)).not.toBeInTheDocument();
    expect(saveButton()).not.toBeDisabled();
  });

  it("passes the composed body to captureFleeting on save (no capture type)", async () => {
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
    useUIStore.setState({ quickCaptureOpen: true });

    render(<QuickCaptureDialog />);
    fireEvent.change(screen.getByPlaceholderText(bodyPlaceholder), {
      target: { value: "a fleeting thought" },
    });
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
    fireEvent.change(screen.getByPlaceholderText(bodyPlaceholder), {
      target: { value: "note body" },
    });
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
    fireEvent.change(screen.getByPlaceholderText(bodyPlaceholder), {
      target: { value: "note body" },
    });
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

describe("QuickCaptureDialog — multiline memo & dismissal guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ locale: LOCALE });
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
    useUIStore.setState({ quickCaptureOpen: true });
  });

  const memoInput = () => screen.getByPlaceholderText(bodyPlaceholder);
  const overlay = () => document.querySelector(".quick-capture-overlay")!;

  it("does NOT save on plain Enter — newline stays in the memo textarea", () => {
    render(<QuickCaptureDialog />);
    fireEvent.change(memoInput(), { target: { value: "line one" } });
    fireEvent.keyDown(memoInput(), { key: "Enter" });

    expect(captureFleeting).not.toHaveBeenCalled();
    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
  });

  it("saves on Mod+Enter", async () => {
    render(<QuickCaptureDialog />);
    fireEvent.change(memoInput(), { target: { value: "line one\nline two" } });
    fireEvent.keyDown(memoInput(), { key: "Enter", metaKey: true });

    await vi.waitFor(() => {
      expect(captureFleeting).toHaveBeenCalledWith(
        "/vault/zettel",
        expect.stringContaining("line one\nline two"),
        [],
      );
    });
    expect(useUIStore.getState().quickCaptureOpen).toBe(false);
  });

  it("ignores outside clicks while any content is typed", () => {
    render(<QuickCaptureDialog />);
    fireEvent.change(memoInput(), { target: { value: "x" } });
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
    fireEvent.change(memoInput(), { target: { value: "x" } });
    fireEvent.keyDown(memoInput(), { key: "Escape" });
    expect(useUIStore.getState().quickCaptureOpen).toBe(true);

    fireEvent.change(memoInput(), { target: { value: "" } });
    fireEvent.keyDown(memoInput(), { key: "Escape" });
    expect(useUIStore.getState().quickCaptureOpen).toBe(false);
  });

  it("Cancel button closes even with content typed", () => {
    render(<QuickCaptureDialog />);
    fireEvent.change(memoInput(), { target: { value: "precious note" } });
    fireEvent.click(screen.getByText(t("common.cancel", "en")));

    expect(useUIStore.getState().quickCaptureOpen).toBe(false);
  });
});
