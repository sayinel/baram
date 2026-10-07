// §29 link-store 단위 테스트
import { beforeEach, describe, expect, it } from "vitest";

import { useLinkStore } from "../editor/link";

describe("linkStore", () => {
  beforeEach(() => {
    useLinkStore.getState().clear();
  });

  it("has correct default state", () => {
    const state = useLinkStore.getState();
    expect(state.backlinks).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.cachedPath).toBeNull();
  });

  it("setBacklinks stores entries and clears loading/error", () => {
    useLinkStore.getState().setLoading(true);
    useLinkStore.getState().setBacklinks("/docs/target.md", [
      {
        sourcePath: "/docs/source1.md",
        targetPath: "/docs/target.md",
        context: "See [[target]] for details",
        line: 10,
      },
      {
        sourcePath: "/docs/source2.md",
        targetPath: "/docs/target.md",
        context: "Refer to [[target|the doc]]",
        line: 5,
      },
    ]);

    const state = useLinkStore.getState();
    expect(state.backlinks).toHaveLength(2);
    expect(state.cachedPath).toBe("/docs/target.md");
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("setLoading updates loading state", () => {
    useLinkStore.getState().setLoading(true);
    expect(useLinkStore.getState().loading).toBe(true);

    useLinkStore.getState().setLoading(false);
    expect(useLinkStore.getState().loading).toBe(false);
  });

  it("setError stores error and clears loading", () => {
    useLinkStore.getState().setLoading(true);
    useLinkStore.getState().setError("Index not available");

    const state = useLinkStore.getState();
    expect(state.error).toBe("Index not available");
    expect(state.loading).toBe(false);
  });

  it("clear resets all state", () => {
    useLinkStore.getState().setBacklinks("/test.md", [
      {
        sourcePath: "/a.md",
        targetPath: "/test.md",
        context: "[[test]]",
        line: 1,
      },
    ]);
    useLinkStore.getState().clear();

    const state = useLinkStore.getState();
    expect(state.backlinks).toEqual([]);
    expect(state.cachedPath).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("setBacklinks replaces previous entries", () => {
    useLinkStore
      .getState()
      .setBacklinks("/a.md", [
        { sourcePath: "/x.md", targetPath: "/a.md", context: "[[a]]", line: 1 },
      ]);
    expect(useLinkStore.getState().backlinks).toHaveLength(1);

    useLinkStore.getState().setBacklinks("/b.md", [
      { sourcePath: "/y.md", targetPath: "/b.md", context: "[[b]]", line: 2 },
      { sourcePath: "/z.md", targetPath: "/b.md", context: "[[b]]", line: 5 },
    ]);
    expect(useLinkStore.getState().backlinks).toHaveLength(2);
    expect(useLinkStore.getState().cachedPath).toBe("/b.md");
  });

  // §34 issue 791 — Backlinks skips its mention search only when the LAST bump
  // came from saving the viewed note.
  // 이것을 실패시키는 것: `invalidate` 가 인자 없는 호출에서 이전 `savedPath` 를 남긴다.
  it("invalidate records the saved file, and forgets it when the cause is unknown", () => {
    useLinkStore.setState({ indexVersion: 0, savedPath: null });
    useLinkStore.getState().invalidate("/v/a.md");
    expect(useLinkStore.getState().savedPath).toBe("/v/a.md");
    useLinkStore.getState().invalidate();
    expect(useLinkStore.getState().savedPath).toBeNull();
    expect(useLinkStore.getState().indexVersion).toBe(2);
  });
});
