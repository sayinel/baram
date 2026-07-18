import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", () => ({
  listDir: vi.fn().mockResolvedValue([]),
  refreshIndex: vi.fn().mockResolvedValue(undefined),
  setVaultRoot: vi.fn().mockResolvedValue(undefined),
}));

import { useFileStore } from "../file/file";

beforeEach(() => {
  useFileStore.setState({
    rootPath: "/r",
    fileTree: [
      {
        name: "docs",
        path: "/r/docs",
        isDir: true,
        children: [{ name: "a.md", path: "/r/docs/a.md", isDir: false }],
      },
      { name: "dest", path: "/r/dest", isDir: true, children: [] },
    ],
    openFiles: new Map([
      ["/r/docs/a.md", "content-a"],
      ["/r/unrelated.md", "keep"],
    ]),
  });
});

describe("moveFileEntry openFiles key migration", () => {
  it("폴더 이동 시 하위 파일의 openFiles 키가 새 경로로 이동한다", () => {
    useFileStore.getState().moveFileEntry("/r/docs", "/r/dest");
    const files = useFileStore.getState().openFiles;
    expect(files.get("/r/dest/docs/a.md")).toBe("content-a");
    expect(files.has("/r/docs/a.md")).toBe(false);
    expect(files.get("/r/unrelated.md")).toBe("keep");
  });
});
