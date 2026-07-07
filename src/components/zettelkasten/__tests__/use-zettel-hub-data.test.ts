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
