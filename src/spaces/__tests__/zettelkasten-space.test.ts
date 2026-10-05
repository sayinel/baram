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
vi.mock("../../services/space-context-migration", () => ({
  reportSpaceDirectoryTaken: (err: unknown) =>
    err instanceof SpaceDirectoryTakenError,
}));
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
import { SpaceDirectoryTakenError } from "../../stores/context/errors";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { refreshZettelIndex } from "../../stores/zettelkasten/zettel-index";
import { zettelkastenSpace } from "../zettelkasten-space";

const ensureSpaceContext = vi.fn(async () => ({ id: "ctx-1" }));

/** The context `getContextForPath` answers for the home note; none by default. */
let holder: null | { contextType: string; id: string } = null;

function mockContextState(hasExisting: boolean) {
  vi.mocked(useContextStore.getState).mockReturnValue({
    spaceContext: vi.fn(() => (hasExisting ? { id: "ctx-1" } : null)),
    ensureSpaceContext,
    getContextForPath: vi.fn(() => holder),
  } as unknown as ReturnType<typeof useContextStore.getState>);
}

function mockSettingsState(overrides: {
  zettelkastenDirectory?: string;
  zettelkastenEnabled: boolean;
  zettelkastenHomeNote?: string;
  zettelkastenStartupBehavior: "nothing" | "openHomeNote";
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
    holder = null;
    vi.mocked(useFileStore.getState).mockReturnValue({
      rootPath: null,
    } as unknown as ReturnType<typeof useFileStore.getState>);
  });

  it("no-ops when no existing space context (never restored)", async () => {
    mockContextState(false);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openHomeNote",
      zettelkastenHomeNote: "home.md",
    });

    await zettelkastenSpace.startup?.();

    expect(ensureSpaceContext).not.toHaveBeenCalled();
    expect(refreshZettelIndex).not.toHaveBeenCalled();
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it("no-ops when zettelkasten is disabled, even with openHomeNote + home note", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: false,
      zettelkastenStartupBehavior: "openHomeNote",
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

    // Registered, not activated: "nothing" must not take the seat — since
    // issue 598 a moved directory switches for real when activation is asked.
    expect(ensureSpaceContext).toHaveBeenCalledWith("zettelkasten", "/zettel", {
      activate: false,
      label: "Zettel",
    });
    expect(refreshZettelIndex).not.toHaveBeenCalled();
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it("stops after reporting a directory that is already another context", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openHomeNote",
      zettelkastenHomeNote: "home.md",
    });
    ensureSpaceContext.mockRejectedValueOnce(
      new SpaceDirectoryTakenError("zettelkasten", "/zettel", {
        addedAt: 0,
        color: "#fff",
        contextType: "vault",
        id: "plain",
        label: "Notes",
        path: "/zettel",
      }),
    );

    await zettelkastenSpace.startup?.();

    // issue 598: the space has no context of its own — indexing that directory
    // or opening its home note would act on a space that does not exist.
    expect(refreshZettelIndex).not.toHaveBeenCalled();
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it("openHomeNote with no home note refreshes the index but opens nothing", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openHomeNote",
      zettelkastenHomeNote: "",
    });

    await zettelkastenSpace.startup?.();

    // §81 Registered, not activated, here too: the launch restore decides the
    // seat; the preset that enters the space switches to it itself.
    expect(ensureSpaceContext).toHaveBeenCalledWith("zettelkasten", "/zettel", {
      activate: false,
      label: "Zettel",
    });

    expect(refreshZettelIndex).toHaveBeenCalledWith("/zettel");
    expect(readFile).not.toHaveBeenCalled();
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it("openHomeNote with a relative home note reads it under the zettel dir and opens it", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openHomeNote",
      zettelkastenHomeNote: "home.md",
    });
    vi.mocked(readFile).mockResolvedValue("# Home\ncontent");

    await zettelkastenSpace.startup?.();

    expect(refreshZettelIndex).toHaveBeenCalledWith("/zettel");
    expect(readFile).toHaveBeenCalledWith("/zettel/home.md");
    expect(openFileInTab).toHaveBeenCalledWith(
      "/zettel/home.md",
      "# Home\ncontent",
      { activate: true, contextId: "ctx-1" },
    );
  });

  it("§81 opens the home note in the background, in the Zettel context, when asked", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openHomeNote",
      zettelkastenHomeNote: "home.md",
    });
    vi.mocked(readFile).mockResolvedValue("# Home");

    await zettelkastenSpace.startup?.({ background: true });

    // The launch restore asks: what it restores is on screen, the note waits
    // behind it — and carries the space's context, not whichever holds the seat.
    expect(openFileInTab).toHaveBeenCalledWith("/zettel/home.md", "# Home", {
      activate: false,
      contextId: "ctx-1",
    });
  });

  it("§81 gives a home note outside the space the context that holds it", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openHomeNote",
      zettelkastenHomeNote: "/work/home.md",
    });
    holder = { contextType: "folder", id: "ctx-work" };
    vi.mocked(readFile).mockResolvedValue("# Home");

    await zettelkastenSpace.startup?.({ background: true });

    // Selecting it later must not switch the app to the Zettel space.
    expect(openFileInTab).toHaveBeenCalledWith("/work/home.md", "# Home", {
      activate: false,
      contextId: "ctx-work",
    });
  });

  it("§81 keeps the Zettel context for that home note when it opens in front", async () => {
    // The preset calls this to enter the Zettel space: the note on screen must
    // not switch the app back to the context that holds its file.
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openHomeNote",
      zettelkastenHomeNote: "/work/home.md",
    });
    holder = { contextType: "folder", id: "ctx-work" };
    vi.mocked(readFile).mockResolvedValue("# Home");

    await zettelkastenSpace.startup?.();

    expect(openFileInTab).toHaveBeenCalledWith("/work/home.md", "# Home", {
      activate: true,
      contextId: "ctx-1",
    });
  });

  it("openHomeNote with an absolute home note path uses it as-is", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openHomeNote",
      zettelkastenHomeNote: "/elsewhere/home.md",
    });
    vi.mocked(readFile).mockResolvedValue("abs content");

    await zettelkastenSpace.startup?.();

    expect(readFile).toHaveBeenCalledWith("/elsewhere/home.md");
    expect(openFileInTab).toHaveBeenCalledWith(
      "/elsewhere/home.md",
      "abs content",
      { activate: true, contextId: "ctx-1" },
    );
  });

  it("openHomeNote swallows a missing/unreadable home note without opening anything", async () => {
    mockContextState(true);
    mockSettingsState({
      zettelkastenEnabled: true,
      zettelkastenStartupBehavior: "openHomeNote",
      zettelkastenHomeNote: "missing.md",
    });
    vi.mocked(readFile).mockRejectedValue(new Error("not found"));

    await expect(zettelkastenSpace.startup?.()).resolves.toBeUndefined();

    expect(refreshZettelIndex).toHaveBeenCalledWith("/zettel");
    expect(openFileInTab).not.toHaveBeenCalled();
  });
});
