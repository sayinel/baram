/*
 * §3.6 rename·move 는 외부 변경 가드(`fileMtimes`)도 새 경로로 옮긴다.
 *
 * 가드는 경로 키다(`canReloadMtime > lastSaveMtime` 이면 자동 저장이 미뤄진다). rename 이
 * `openFiles` 만 새 키로 옮기고 `fileMtimes` 를 옛 키에 두면, 미해결 외부 변경이 걸린 파일을
 * 이름만 바꿔도 새 경로의 가드가 비어 자동 저장이 그 변경을 덮는다.
 */
import type { FileEntry } from "../file";

import { beforeEach, describe, expect, it } from "vitest";

import { useFileStore } from "../file";

const GUARD = { canReloadMtime: 2000, lastSaveMtime: 1000 };

const f = (name: string, path: string, isDir = false): FileEntry => ({
  children: isDir ? [] : undefined,
  isDir,
  name,
  path,
});

beforeEach(() => {
  useFileStore.setState({
    fileMtimes: new Map(),
    fileTree: [],
    openFiles: new Map(),
    rootPath: "/r",
  });
});

describe("§3.6 fileMtimes follow a rename or move", () => {
  it("renameFileEntry moves the guard to the new path", () => {
    // 이것을 실패시키는 것: renameFileEntry 에서 fileMtimes 재키잉 제거.
    useFileStore.setState({ fileMtimes: new Map([["/r/a.md", GUARD]]) });

    useFileStore.getState().renameFileEntry("/r/a.md", "/r/a2.md", "a2.md");

    expect(useFileStore.getState().getFileMtime("/r/a2.md")).toEqual(GUARD);
    expect(useFileStore.getState().getFileMtime("/r/a.md")).toBeUndefined();
  });

  it("a directory rename moves every guard under it, and nothing beside it", () => {
    // 이것을 실패시키는 것: 접두 경계 검사를 `key.startsWith(oldPrefix)` 로 느슨하게(형제 `/r/docs2`
    // 까지 옮겨진다).
    useFileStore.setState({
      fileMtimes: new Map([
        ["/r/docs2/c.md", GUARD],
        ["/r/docs/a.md", GUARD],
        ["/r/docs/sub/b.md", GUARD],
      ]),
    });

    useFileStore.getState().renameFileEntry("/r/docs", "/r/notes", "notes");

    const { fileMtimes } = useFileStore.getState();
    expect([...fileMtimes.keys()].sort()).toEqual([
      "/r/docs2/c.md",
      "/r/notes/a.md",
      "/r/notes/sub/b.md",
    ]);
  });

  it("moveFileEntry moves the guard to the new path", () => {
    // 이것을 실패시키는 것: moveFileEntry 에서 fileMtimes 재키잉 제거.
    useFileStore.setState({
      fileMtimes: new Map([["/r/a.md", GUARD]]),
      fileTree: [f("a.md", "/r/a.md"), f("dest", "/r/dest", true)],
    });

    useFileStore.getState().moveFileEntry("/r/a.md", "/r/dest");

    expect(useFileStore.getState().getFileMtime("/r/dest/a.md")).toEqual(GUARD);
    expect(useFileStore.getState().getFileMtime("/r/a.md")).toBeUndefined();
  });
});
