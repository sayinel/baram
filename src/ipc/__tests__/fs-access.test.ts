import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  FolderAccessDeniedError,
  isFolderAccessDeniedError,
  listDir,
} from "../fs";

describe("listDir — folder access denial", () => {
  beforeEach(() => invokeMock.mockReset());

  it("throws a typed FolderAccessDeniedError on the PERMISSION_DENIED sentinel", async () => {
    invokeMock.mockRejectedValueOnce(
      "PERMISSION_DENIED:/Users/x/Documents/notes",
    );
    await expect(
      listDir("/Users/x/Documents/notes", true),
    ).rejects.toBeInstanceOf(FolderAccessDeniedError);
    try {
      await listDir("/Users/x/Documents/notes", true);
    } catch (e) {
      expect(isFolderAccessDeniedError(e)).toBe(true);
      expect((e as FolderAccessDeniedError).path).toBe(
        "/Users/x/Documents/notes",
      );
    }
  });

  it("re-throws other errors unchanged", async () => {
    invokeMock.mockRejectedValueOnce("some other error");
    await expect(listDir("/x", true)).rejects.toBe("some other error");
    expect(isFolderAccessDeniedError("some other error")).toBe(false);
  });

  it("returns entries on success", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await expect(listDir("/x", true)).resolves.toEqual([]);
  });
});
