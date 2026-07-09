import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

describe("general settings — recent items", () => {
  beforeEach(() => {
    useSettingsStore.setState({ recentFolders: [], recentFiles: [] });
  });

  it("addRecentFolder stores the isVault flag and dedups by path", () => {
    const s = useSettingsStore.getState();
    s.addRecentFolder("/a/vault", true);
    s.addRecentFolder("/b/plain", false);
    s.addRecentFolder("/a/vault", true); // re-add → dedup, still one entry, most recent first

    const { recentFolders } = useSettingsStore.getState();
    expect(recentFolders).toHaveLength(2);
    expect(recentFolders[0]).toMatchObject({ path: "/a/vault", isVault: true });
    expect(recentFolders[1]).toMatchObject({
      path: "/b/plain",
      isVault: false,
    });
  });

  it("addRecentFolder without isVault preserves a previously known flag on re-add", () => {
    const s = useSettingsStore.getState();
    s.addRecentFolder("/a/vault", true);
    s.addRecentFolder("/a/vault"); // omitted → must not clobber isVault
    expect(useSettingsStore.getState().recentFolders[0].isVault).toBe(true);
  });

  it("addRecentFolder caps the list at 5", () => {
    const s = useSettingsStore.getState();
    for (let i = 0; i < 7; i++) s.addRecentFolder(`/f/${i}`);
    expect(useSettingsStore.getState().recentFolders).toHaveLength(5);
  });

  it("removeRecentFolder / removeRecentFile remove only the matching path", () => {
    const s = useSettingsStore.getState();
    s.addRecentFolder("/keep");
    s.addRecentFolder("/drop");
    s.addRecentFile("/keep.md");
    s.addRecentFile("/drop.md");

    s.removeRecentFolder("/drop");
    s.removeRecentFile("/drop.md");

    const st = useSettingsStore.getState();
    expect(st.recentFolders.map((f) => f.path)).toEqual(["/keep"]);
    expect(st.recentFiles.map((f) => f.path)).toEqual(["/keep.md"]);
  });

  it("clearRecent empties both lists but keeps lastOpened*", () => {
    const s = useSettingsStore.getState();
    s.addRecentFolder("/x");
    s.addRecentFile("/x.md");
    s.clearRecent();
    const st = useSettingsStore.getState();
    expect(st.recentFolders).toEqual([]);
    expect(st.recentFiles).toEqual([]);
    expect(st.lastOpenedFolder).toBe("/x");
    expect(st.lastOpenedFile).toBe("/x.md");
  });
});
