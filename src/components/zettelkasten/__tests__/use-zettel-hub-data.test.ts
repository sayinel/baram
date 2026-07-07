import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level consts, so the mocked fns
// must be created via vi.hoisted() to be safely referenced inside them.
const { listDir, readFile } = vi.hoisted(() => ({
  listDir: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("../../../ipc/invoke", () => ({ listDir, readFile }));

const { getFilesByTag } = vi.hoisted(() => ({ getFilesByTag: vi.fn() }));
vi.mock("../../../ipc/tag", () => ({ getFilesByTag }));

import { useZettelIndexStore } from "../../../stores/zettelkasten/zettel-index";
import { useZettelHubData } from "../use-zettel-hub-data";

/** Wires listDir/readFile/getFilesByTag to a one-note fixture named by `tag`. */
function mockFixture(tag: string) {
  listDir.mockImplementation(async (dir: string) => {
    if (dir.endsWith("/inbox")) {
      return [
        {
          isDir: false,
          modifiedAt: 1,
          name: `${tag}.md`,
          path: `/z/inbox/${tag}.md`,
          size: 0,
        },
      ];
    }
    if (dir.endsWith("/notes")) {
      return [
        {
          isDir: false,
          modifiedAt: 1,
          name: `202607${tag} Note.md`,
          path: `/z/notes/202607${tag} Note.md`,
          size: 0,
        },
      ];
    }
    return [];
  });
  readFile.mockResolvedValue(`${tag} body`);
  getFilesByTag.mockResolvedValue([]);
}

describe("useZettelHubData", () => {
  beforeEach(() => {
    useZettelIndexStore.getState().clear();
    listDir.mockReset();
    readFile.mockReset();
    getFilesByTag.mockReset();
  });

  it("derives inbox/recent/mocs from the mocked IPC on initial load", async () => {
    mockFixture("aaa");

    const { result } = renderHook(() => useZettelHubData("/z"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.inbox).toHaveLength(1);
    expect(result.current.inbox[0].path).toBe("/z/inbox/aaa.md");
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0].path).toBe("/z/notes/202607aaa Note.md");
  });

  it("re-derives the lists when the zettel index changes (e.g. a capture elsewhere)", async () => {
    mockFixture("aaa");

    const { result } = renderHook(() => useZettelHubData("/z"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.inbox[0].path).toBe("/z/inbox/aaa.md");

    const callsBefore = listDir.mock.calls.length;
    mockFixture("bbb");

    act(() => {
      useZettelIndexStore
        .getState()
        .upsert({ id: "bbb", path: "/z/inbox/bbb.md", title: "bbb" });
    });

    await waitFor(() => {
      expect(listDir.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(result.current.inbox[0]?.path).toBe("/z/inbox/bbb.md");
    });
  });

  it("MOCs: only notes/ paths, sorted by title, capped at 12", async () => {
    listDir.mockResolvedValue([]);
    readFile.mockResolvedValue("");
    // 13 notes/ MOCs (unsorted titles) + 1 inbox/ note wrongly tagged #moc.
    getFilesByTag.mockResolvedValue([
      "inbox/999999999999 Fleeting.md",
      "notes/202607010001 Zeta.md",
      "notes/202607010002 Alpha.md",
      "notes/202607010003 Mike.md",
      "notes/202607010004 Bravo.md",
      "notes/202607010005 November.md",
      "notes/202607010006 Charlie.md",
      "notes/202607010007 Oscar.md",
      "notes/202607010008 Delta.md",
      "notes/202607010009 Papa.md",
      "notes/202607010010 Echo.md",
      "notes/202607010011 Quebec.md",
      "notes/202607010012 Foxtrot.md",
      "notes/202607010013 Romeo.md",
    ]);

    const { result } = renderHook(() => useZettelHubData("/z"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.mocs).toHaveLength(12);
    expect(
      result.current.mocs.some(
        (m) => m.path === "/z/inbox/999999999999 Fleeting.md",
      ),
    ).toBe(false);
    const titles = result.current.mocs.map((m) => m.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
    // "Zeta" sorts last alphabetically, so the 12-item cap truncates it off.
    expect(titles).not.toContain("Zeta");
  });

  it("MOCs: normalizes Windows backslash separators before the notes/ filter", async () => {
    listDir.mockResolvedValue([]);
    readFile.mockResolvedValue("");
    // getFilesByTag's Rust backend returns OS-native separators — on Windows
    // that's backslash. A real MOC under notes\ must still be included, and
    // a fleeting inbox\ note wrongly tagged #moc must still be excluded.
    getFilesByTag.mockResolvedValue([
      "notes\\202607071000 Alpha.md",
      "inbox\\202607071200.md",
    ]);

    const { result } = renderHook(() => useZettelHubData("/z"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.mocs).toHaveLength(1);
    expect(result.current.mocs[0].path).toBe("/z/notes/202607071000 Alpha.md");
    expect(result.current.mocs[0].title).toBe("Alpha");
    expect(result.current.mocs.some((m) => m.path.includes("inbox"))).toBe(
      false,
    );
  });

  it("returns empty lists and does not call IPC when zettelDir is null", async () => {
    const { result } = renderHook(() => useZettelHubData(null));

    expect(result.current.loading).toBe(false);
    expect(result.current.inbox).toEqual([]);
    expect(result.current.mocs).toEqual([]);
    expect(result.current.recent).toEqual([]);
    expect(listDir).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("generation guard: two rapid refreshes settle on the latest data, not a stale overwrite", async () => {
    mockFixture("aaa");
    const { result } = renderHook(() => useZettelHubData("/z"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // First refresh is slow; second (from the index change) resolves first.
    let resolveSlow: (() => void) | undefined;
    listDir.mockImplementation(
      (dir: string) =>
        new Promise((resolve) => {
          const respond = () => {
            if (dir.endsWith("/inbox")) {
              resolve([
                {
                  isDir: false,
                  modifiedAt: 1,
                  name: "stale.md",
                  path: "/z/inbox/stale.md",
                  size: 0,
                },
              ]);
            } else {
              resolve([]);
            }
          };
          if (dir.endsWith("/inbox")) {
            resolveSlow = respond;
          } else {
            respond();
          }
        }),
    );

    const slowRefresh = result.current.refresh();
    mockFixture("fresh");
    act(() => {
      useZettelIndexStore
        .getState()
        .upsert({ id: "fresh", path: "/z/inbox/fresh.md", title: "fresh" });
    });

    await waitFor(() =>
      expect(result.current.inbox[0]?.path).toBe("/z/inbox/fresh.md"),
    );

    resolveSlow?.();
    await slowRefresh;

    // The slow, stale refresh must not clobber the fresher result.
    expect(result.current.inbox[0]?.path).toBe("/z/inbox/fresh.md");
  });
});
