import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../ipc/tag", () => ({
  getFilesByTag: vi.fn().mockResolvedValue([]),
}));

import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { ZettelHubPanel } from "../ZettelHubPanel";

describe("ZettelHubPanel", () => {
  it("renders the Actions bar (New / Capture / MOC)", () => {
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");

    render(<ZettelHubPanel />);

    expect(
      screen.getByRole("button", { name: /new zettel/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /quick capture/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new moc/i }),
    ).toBeInTheDocument();
  });
});
