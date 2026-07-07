import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
}));
vi.mock("../../../services/zettelkasten-service", () => ({
  captureFleeting: vi.fn().mockResolvedValue({ path: "/z/inbox/x.md" }),
}));

import { captureFleeting } from "../../../services/zettelkasten-service";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { QuickCaptureDialog } from "../QuickCaptureDialog";

describe("QuickCaptureDialog — zettel space gating (§95/§99 M4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.getState().setZettelkastenEnabled(false);
    useSettingsStore.getState().setZettelkastenDirectory("");
    useFileStore.getState().setRootPath(null);
    useUIStore.setState({ quickCaptureOpen: true });
  });

  it("shows the setup hint and disables Save immediately when the zettel space isn't configured", () => {
    render(<QuickCaptureDialog />);

    expect(
      screen.getByText("제텔카스텐 공간을 먼저 설정하세요."),
    ).toBeInTheDocument();
    expect(screen.getByText("저장 (Enter)")).toBeDisabled();
  });

  it("hides the hint and enables Save once the zettel space is configured", () => {
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");

    render(<QuickCaptureDialog />);
    fireEvent.change(screen.getByPlaceholderText("메모를 입력하세요..."), {
      target: { value: "hello" },
    });

    expect(
      screen.queryByText("제텔카스텐 공간을 먼저 설정하세요."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("저장 (Enter)")).not.toBeDisabled();
  });

  it("passes the composed body to captureFleeting on save (no capture type)", async () => {
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
    useUIStore.setState({ quickCaptureOpen: true });

    render(<QuickCaptureDialog />);
    fireEvent.change(screen.getByPlaceholderText("메모를 입력하세요..."), {
      target: { value: "a fleeting thought" },
    });
    fireEvent.click(screen.getByText("저장 (Enter)"));

    await vi.waitFor(() => {
      // Exactly two args — the type parameter is gone (§99 A).
      expect(captureFleeting).toHaveBeenCalledWith(
        "/vault/zettel",
        expect.stringContaining("a fleeting thought"),
      );
    });
  });

  it("folds the optional source into the captured body", async () => {
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
    useUIStore.setState({ quickCaptureOpen: true });

    render(<QuickCaptureDialog />);
    fireEvent.change(screen.getByPlaceholderText("메모를 입력하세요..."), {
      target: { value: "note body" },
    });
    fireEvent.change(screen.getByPlaceholderText("출처 (선택): https://..."), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByText("저장 (Enter)"));

    await vi.waitFor(() => {
      expect(captureFleeting).toHaveBeenCalledWith(
        "/vault/zettel",
        expect.stringContaining("Source: https://example.com"),
      );
    });
  });
});
