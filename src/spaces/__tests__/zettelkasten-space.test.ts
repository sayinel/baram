// §98 zettelkastenSpace.startup gating — home note / inbox open on app launch
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock context store
vi.mock("../../stores/context/context", () => ({
  useContextStore: {
    getState: vi.fn(),
  },
}));

// Mock file store
vi.mock("../../stores/file/file", () => ({
  useFileStore: {
    getState: vi.fn(),
  },
}));

// Mock settings store
vi.mock("../../stores/settings/store", () => ({
  useSettingsStore: {
    getState: vi.fn(),
  },
}));

// Mock zettel index refresh
vi.mock("../../stores/zettelkasten/zettel-index", () => ({
  refreshZettelIndex: vi.fn(async () => undefined),
}));

// Mock journal-file-service's openFileInTab (shared tab-open helper)
vi.mock("../../services/journal-file-service", () => ({
  openFileInTab: vi.fn(async () => undefined),
}));

// Mock IPC readFile
vi.mock("../../ipc/invoke", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "../../ipc/invoke";
import { openFileInTab } from "../../services/journal-file-service";
import { useContextStore } from "../../stores/context/context";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { refreshZettelIndex } from "../../stores/zettelkasten/zettel-index";
import { zettelkastenSpace } from "../zettelkasten-space";

const ensureSpaceContext = vi.fn(async () => undefined);

function mockContextState(hasExisting: boolean) {
  vi.mocked(useContextStore.getState).mockReturnValue({
    spaceContext: vi.fn(() => (hasExisting ? { id: "ctx-1" } : null)),
    ensureSpaceContext,
  } as unknown as ReturnType<typeof useContextStore.getState>);
}

function mockSettingsState(overrides: {
  zettelkastenDirectory?: string;
  zettelkastenEnabled: boolean;
  zettelkastenHomeNote?: string;
  zettelkastenStartupBehavior: "nothing" | "openInbox";
}) {
  vi.mocked(useSettingsStore.getState).mockReturnValue({
    zettelkastenDirectory: "/zettel",
    zettelkastenHomeNote: "",
    ...overrides,
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
}

describe("§98 zettelkastenSpace.startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureSpaceContext.mockClear();
    vi.mocked(useFileStore.getState).mockReturnValue({
      rootPath: null,
    } as unknown as ReturnType<typeof useFileStore.getState>);
  });

  it("no-ops when no existing space context (never restored)", async () => {
    mockContextState(false);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openInbox",
      zettelkastenHomeNote: "home.md",
    });

    await zettelkastenSpace.startup?.();

    expect(ensureSpaceContext).not.toHaveBeenCalled();
    expect(refreshZettelIndex).not.toHaveBeenCalled();
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it("no-ops when zettelkasten is disabled, even with openInbox + home note", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: false,
      zettelkastenStartupBehavior: "openInbox",
      zettelkastenHomeNote: "home.md",
    });

    await zettelkastenSpace.startup?.();

    expect(ensureSpaceContext).not.toHaveBeenCalled();
    expect(refreshZettelIndex).not.toHaveBeenCalled();
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it('ensures context but does not refresh index or open a note when startup behavior is "nothing"', async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "nothing",
      zettelkastenHomeNote: "home.md",
    });

    await zettelkastenSpace.startup?.();

    expect(ensureSpaceContext).toHaveBeenCalledWith("zettelkasten", "/zettel", {
      label: "Zettel",
    });
    expect(refreshZettelIndex).not.toHaveBeenCalled();
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it("openInbox with no home note refreshes the index but opens nothing", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openInbox",
      zettelkastenHomeNote: "",
    });

    await zettelkastenSpace.startup?.();

    expect(refreshZettelIndex).toHaveBeenCalledWith("/zettel");
    expect(readFile).not.toHaveBeenCalled();
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it("openInbox with a relative home note reads it under the zettel dir and opens it", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openInbox",
      zettelkastenHomeNote: "home.md",
    });
    vi.mocked(readFile).mockResolvedValue("# Home\ncontent");

    await zettelkastenSpace.startup?.();

    expect(refreshZettelIndex).toHaveBeenCalledWith("/zettel");
    expect(readFile).toHaveBeenCalledWith("/zettel/home.md");
    expect(openFileInTab).toHaveBeenCalledWith(
      "/zettel/home.md",
      "# Home\ncontent",
    );
  });

  it("openInbox with an absolute home note path uses it as-is", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openInbox",
      zettelkastenHomeNote: "/elsewhere/home.md",
    });
    vi.mocked(readFile).mockResolvedValue("abs content");

    await zettelkastenSpace.startup?.();

    expect(readFile).toHaveBeenCalledWith("/elsewhere/home.md");
    expect(openFileInTab).toHaveBeenCalledWith(
      "/elsewhere/home.md",
      "abs content",
    );
  });

  it("openInbox swallows a missing/unreadable home note without opening anything", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openInbox",
      zettelkastenHomeNote: "missing.md",
    });
    vi.mocked(readFile).mockRejectedValue(new Error("not found"));

    await expect(zettelkastenSpace.startup?.()).resolves.toBeUndefined();

    expect(refreshZettelIndex).toHaveBeenCalledWith("/zettel");
    expect(openFileInTab).not.toHaveBeenCalled();
  });
});
