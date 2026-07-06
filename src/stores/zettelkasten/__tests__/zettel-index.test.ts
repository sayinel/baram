import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level consts, so the mocked fns
// must be created via vi.hoisted() to be safely referenced inside them.
const { listDir, readFile } = vi.hoisted(() => ({
  listDir: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("../../../ipc/invoke", () => ({ listDir, readFile }));

import {
  idForTitle,
  maybeRefreshForPath,
  refreshZettelIndex,
  titleForId,
  useZettelIndexStore,
} from "../zettel-index";

describe("zettel index", () => {
  beforeEach(() => useZettelIndexStore.getState().clear());

  it("builds id→title from notes/ + inbox/ and resolves both directions", async () => {
    listDir.mockImplementation(async (dir: string) =>
      dir.endsWith("/notes")
        ? [
            {
              name: "202607051530 원자적 노트.md",
              path: `${dir}/202607051530 원자적 노트.md`,
            },
          ]
        : [{ name: "202607051600.md", path: `${dir}/202607051600.md` }],
    );
    readFile.mockResolvedValue("no frontmatter");
    await refreshZettelIndex("/z");
    expect(titleForId("202607051530")).toBe("원자적 노트");
    expect(idForTitle("원자적 노트")).toBe("202607051530");
    expect(titleForId("202607051600")).toBe("202607051600"); // fleeting, no title
  });

  it("idForTitle returns null when ambiguous", () => {
    useZettelIndexStore.getState().setAll([
      { id: "1", path: "a", title: "dup" },
      { id: "2", path: "b", title: "dup" },
    ]);
    expect(idForTitle("dup")).toBeNull();
  });
});

describe("maybeRefreshForPath", () => {
  beforeEach(() => {
    useZettelIndexStore.getState().clear();
    listDir.mockReset();
    readFile.mockReset();
  });

  it("refreshes when opening a path under the zettel dir while the index is empty", async () => {
    listDir.mockImplementation(async (dir: string) =>
      dir.endsWith("/notes")
        ? [
            {
              name: "202607051530 title.md",
              path: `${dir}/202607051530 title.md`,
            },
          ]
        : [],
    );
    readFile.mockResolvedValue("no frontmatter");

    await maybeRefreshForPath("/z/notes/202607051530 title.md", "/z");

    expect(titleForId("202607051530")).toBe("title");
  });

  it("does nothing for a path outside the zettel dir", async () => {
    await maybeRefreshForPath("/other/notes/foo.md", "/z");

    expect(listDir).not.toHaveBeenCalled();
    expect(Object.keys(useZettelIndexStore.getState().byId)).toHaveLength(0);
  });

  it("does nothing when the index is already populated", async () => {
    useZettelIndexStore
      .getState()
      .setAll([{ id: "1", path: "/z/notes/a.md", title: "a" }]);

    await maybeRefreshForPath("/z/notes/b.md", "/z");

    expect(listDir).not.toHaveBeenCalled();
    expect(titleForId("1")).toBe("a");
  });

  it("does nothing when zettelDir is null", async () => {
    await maybeRefreshForPath("/z/notes/foo.md", null);

    expect(listDir).not.toHaveBeenCalled();
  });
});
