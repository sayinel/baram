import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildRecentMenuEntries, handleRecentMenuEvent } from "../recent-menu";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const openFolderMock = vi.hoisted(() => vi.fn());
const openFileMock = vi.hoisted(() => vi.fn());
vi.mock("../../utils/recent-open", () => ({
  openRecentFolder: openFolderMock,
  openRecentFile: openFileMock,
}));

const clearRecentMock = vi.hoisted(() => vi.fn());
vi.mock("../../stores/settings/store", () => ({
  useSettingsStore: { getState: () => ({ clearRecent: clearRecentMock }) },
}));

const folder = (path: string, isVault?: boolean) => ({
  path,
  lastOpened: 0,
  isVault,
});
const file = (path: string) => ({ path, lastOpened: 0 });

describe("buildRecentMenuEntries", () => {
  it("returns [] when there are no recents", () => {
    expect(buildRecentMenuEntries([], [], "en")).toEqual([]);
  });

  it("emits folders, files, and a trailing clear action in order", () => {
    const entries = buildRecentMenuEntries(
      [folder("/a/vault", true), folder("/a/docs")],
      [file("/a/notes.md")],
      "en",
    );
    expect(entries).toEqual([
      { kind: "item", label: "Recent Folders", enabled: false },
      { kind: "item", id: "recent_folder:/a/vault", label: "vault — Vault" },
      { kind: "item", id: "recent_folder:/a/docs", label: "docs" },
      { kind: "separator" },
      { kind: "item", label: "Recent Files", enabled: false },
      { kind: "item", id: "recent_file:/a/notes.md", label: "notes.md" },
      { kind: "separator" },
      { kind: "item", id: "recent_clear", label: "Clear Recent" },
    ]);
  });

  it("omits the folders section when there are no folders", () => {
    const entries = buildRecentMenuEntries([], [file("/a/notes.md")], "en");
    expect(entries).toEqual([
      { kind: "item", label: "Recent Files", enabled: false },
      { kind: "item", id: "recent_file:/a/notes.md", label: "notes.md" },
      { kind: "separator" },
      { kind: "item", id: "recent_clear", label: "Clear Recent" },
    ]);
  });

  it("caps each section at 5 items", () => {
    const many = Array.from({ length: 8 }, (_, i) => file(`/a/f${i}.md`));
    const entries = buildRecentMenuEntries([], many, "en");
    const fileItems = entries.filter((e) => e.id?.startsWith("recent_file:"));
    expect(fileItems).toHaveLength(5);
  });
});

describe("handleRecentMenuEvent", () => {
  beforeEach(() => {
    openFolderMock.mockReset();
    openFileMock.mockReset();
    clearRecentMock.mockReset();
  });

  it("routes recent_folder: to openRecentFolder with the decoded path", () => {
    expect(handleRecentMenuEvent("recent_folder:/a/b:c")).toBe(true);
    expect(openFolderMock).toHaveBeenCalledWith("/a/b:c");
  });

  it("routes recent_file: to openRecentFile with the decoded path", () => {
    expect(handleRecentMenuEvent("recent_file:/a/n.md")).toBe(true);
    expect(openFileMock).toHaveBeenCalledWith("/a/n.md");
  });

  it("routes recent_clear to clearRecent", () => {
    expect(handleRecentMenuEvent("recent_clear")).toBe(true);
    expect(clearRecentMock).toHaveBeenCalledTimes(1);
  });

  it("returns false for unrelated payloads", () => {
    expect(handleRecentMenuEvent("file_save")).toBe(false);
    expect(openFolderMock).not.toHaveBeenCalled();
  });
});
