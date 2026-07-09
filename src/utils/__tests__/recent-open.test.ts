import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addFolder } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { openFileByPath } from "../open-file";
import { openRecentFile, openRecentFolder } from "../recent-open";

vi.mock("../../stores/file/file", () => ({ addFolder: vi.fn() }));
vi.mock("../open-file", () => ({ openFileByPath: vi.fn() }));

const mockAddFolder = vi.mocked(addFolder);
const mockOpenFile = vi.mocked(openFileByPath);

let removeRecentFolder: ReturnType<typeof vi.fn>;
let removeRecentFile: ReturnType<typeof vi.fn>;
let showToast: ReturnType<typeof vi.fn>;

beforeEach(() => {
  removeRecentFolder = vi.fn();
  removeRecentFile = vi.fn();
  showToast = vi.fn();
  useSettingsStore.setState({ removeRecentFolder, removeRecentFile } as never);
  useUIStore.setState({ showToast } as never);
});

afterEach(() => vi.clearAllMocks());

describe("openRecentFolder", () => {
  it("opens the folder and does not touch recents on success", async () => {
    mockAddFolder.mockResolvedValue();
    await openRecentFolder("/ok");
    expect(mockAddFolder).toHaveBeenCalledWith("/ok");
    expect(removeRecentFolder).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("removes the entry and toasts when opening fails", async () => {
    mockAddFolder.mockRejectedValue(new Error("gone"));
    await openRecentFolder("/gone");
    expect(removeRecentFolder).toHaveBeenCalledWith("/gone");
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});

describe("openRecentFile", () => {
  it("removes the entry and toasts when opening fails", async () => {
    mockOpenFile.mockRejectedValue(new Error("gone"));
    await openRecentFile("/gone.md");
    expect(removeRecentFile).toHaveBeenCalledWith("/gone.md");
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
