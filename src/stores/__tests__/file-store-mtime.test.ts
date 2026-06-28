// Phase 1: mtime tracking fields for external file change detection
import { beforeEach, describe, expect, it } from "vitest";

import { useFileStore } from "../file/file";

beforeEach(() => {
  useFileStore.setState({
    openFiles: new Map(),
    fileMtimes: new Map(),
  });
});

describe("initFileMtime", () => {
  it("initializes both mtime fields to 0", () => {
    useFileStore.getState().initFileMtime("/a/b.md");
    const entry = useFileStore.getState().getFileMtime("/a/b.md");
    expect(entry).toEqual({ lastSaveMtime: 0, canReloadMtime: 0 });
  });

  it("overwrites an existing entry with zeroes", () => {
    useFileStore.getState().initFileMtime("/a/b.md");
    useFileStore.getState().updateLastSaveMtime("/a/b.md", 1000);
    useFileStore.getState().initFileMtime("/a/b.md");
    const entry = useFileStore.getState().getFileMtime("/a/b.md");
    expect(entry).toEqual({ lastSaveMtime: 0, canReloadMtime: 0 });
  });
});

describe("getFileMtime", () => {
  it("returns undefined for untracked path", () => {
    expect(useFileStore.getState().getFileMtime("/no/such.md")).toBeUndefined();
  });
});

describe("updateLastSaveMtime", () => {
  it("sets lastSaveMtime and preserves canReloadMtime", () => {
    useFileStore.getState().initFileMtime("/a/b.md");
    useFileStore.getState().updateCanReloadMtime("/a/b.md", 2000);
    useFileStore.getState().updateLastSaveMtime("/a/b.md", 1500);
    const entry = useFileStore.getState().getFileMtime("/a/b.md");
    expect(entry).toEqual({ lastSaveMtime: 1500, canReloadMtime: 2000 });
  });

  it("creates the entry if not yet tracked", () => {
    useFileStore.getState().updateLastSaveMtime("/new.md", 999);
    const entry = useFileStore.getState().getFileMtime("/new.md");
    expect(entry).toEqual({ lastSaveMtime: 999, canReloadMtime: 0 });
  });
});

describe("updateCanReloadMtime", () => {
  it("sets canReloadMtime and preserves lastSaveMtime", () => {
    useFileStore.getState().initFileMtime("/a/b.md");
    useFileStore.getState().updateLastSaveMtime("/a/b.md", 1500);
    useFileStore.getState().updateCanReloadMtime("/a/b.md", 3000);
    const entry = useFileStore.getState().getFileMtime("/a/b.md");
    expect(entry).toEqual({ lastSaveMtime: 1500, canReloadMtime: 3000 });
  });

  it("creates the entry if not yet tracked", () => {
    useFileStore.getState().updateCanReloadMtime("/new.md", 42);
    const entry = useFileStore.getState().getFileMtime("/new.md");
    expect(entry).toEqual({ lastSaveMtime: 0, canReloadMtime: 42 });
  });
});

describe("removeFileContent cleans up mtime entry", () => {
  it("removes the mtime entry when file content is removed", () => {
    useFileStore.getState().initFileMtime("/a/b.md");
    useFileStore.getState().setFileContent("/a/b.md", "hello");
    useFileStore.getState().removeFileContent("/a/b.md");
    expect(useFileStore.getState().getFileMtime("/a/b.md")).toBeUndefined();
    expect(useFileStore.getState().openFiles.get("/a/b.md")).toBeUndefined();
  });
});

describe("independent paths do not interfere", () => {
  it("updating one path does not affect another", () => {
    useFileStore.getState().initFileMtime("/a.md");
    useFileStore.getState().initFileMtime("/b.md");
    useFileStore.getState().updateLastSaveMtime("/a.md", 100);
    useFileStore.getState().updateCanReloadMtime("/b.md", 200);
    expect(useFileStore.getState().getFileMtime("/a.md")).toEqual({
      lastSaveMtime: 100,
      canReloadMtime: 0,
    });
    expect(useFileStore.getState().getFileMtime("/b.md")).toEqual({
      lastSaveMtime: 0,
      canReloadMtime: 200,
    });
  });
});
