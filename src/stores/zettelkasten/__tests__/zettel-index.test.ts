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
