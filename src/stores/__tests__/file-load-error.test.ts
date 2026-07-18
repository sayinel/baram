import { beforeEach, describe, expect, it, vi } from "vitest";

import { FolderAccessDeniedError } from "../../ipc/fs";

const showToastMock = vi.hoisted(() => vi.fn());
const listDirMock = vi.hoisted(() => vi.fn());

vi.mock("../../ipc/invoke", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/invoke")>();
  return {
    ...actual,
    listDir: listDirMock,
    refreshIndex: vi.fn(async () => ({ fileCount: 0, linkCount: 0 })),
    setVaultRoot: vi.fn(async () => undefined),
  };
});
vi.mock("../ui/ui", () => ({
  useUIStore: { getState: () => ({ showToast: showToastMock }) },
}));

import { useFileStore } from "../file/file";

const DIR = "/Users/x/Documents/notes";

describe("file store — loadError surfacing", () => {
  beforeEach(() => {
    showToastMock.mockReset();
    listDirMock.mockReset();
    useFileStore.setState({
      rootPath: DIR,
      loadError: null,
      fileTree: [],
    } as never);
  });

  it("sets a permission-denied loadError and toasts when listDir is denied", async () => {
    listDirMock.mockRejectedValueOnce(new FolderAccessDeniedError(DIR));
    await useFileStore.getState().retryLoadFileTree();
    const err = useFileStore.getState().loadError;
    expect(err).toEqual({ kind: "permission-denied", path: DIR });
    expect(showToastMock).toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("sets a generic loadError for non-permission failures", async () => {
    listDirMock.mockRejectedValueOnce(new Error("disk exploded"));
    await useFileStore.getState().retryLoadFileTree();
    expect(useFileStore.getState().loadError).toEqual({
      kind: "generic",
      path: DIR,
      message: "disk exploded",
    });
  });

  it("clears loadError on a successful (re)load", async () => {
    useFileStore.setState({
      loadError: { kind: "permission-denied", path: DIR },
    } as never);
    listDirMock.mockResolvedValueOnce([]);
    await useFileStore.getState().retryLoadFileTree();
    expect(useFileStore.getState().loadError).toBeNull();
  });
});
