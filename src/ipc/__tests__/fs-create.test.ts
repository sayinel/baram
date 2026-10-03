// §4.3 `createFile` — create a NEW file, never replace one.
//
// `writeFile` replaces whatever is at the path (Rust writes a temp file and renames it over
// the target), so a caller that means "make a new file" cannot use it without first proving
// the path is free — and the app has no way to prove that from its own state: the file tree
// can be stale, hides dot-files, and compares names exactly, while a volume that ignores
// case (the macOS and Windows default) treats `readme.md` and `README.md` as one file. `create_file` asks the OS (`create_new`), and
// refuses with the stable `ALREADY_EXISTS:` sentinel, which this wrapper turns into a type.
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { createFile, FileExistsError, isFileExistsError } from "../fs";

describe("createFile", () => {
  beforeEach(() => invokeMock.mockReset());

  it("asks the backend to create the file with its content", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await expect(createFile("/v/new.md", "# new\n")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("create_file", {
      content: "# new\n",
      path: "/v/new.md",
    });
  });

  it("throws a typed FileExistsError on the ALREADY_EXISTS sentinel", async () => {
    invokeMock.mockRejectedValueOnce("ALREADY_EXISTS:/v/readme.md");

    const error = await createFile("/v/readme.md", "").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FileExistsError);
    expect(isFileExistsError(error)).toBe(true);
    expect((error as FileExistsError).path).toBe("/v/readme.md");
  });

  it("re-throws any other failure unchanged", async () => {
    invokeMock.mockRejectedValueOnce("파일 읽기 실패: permission denied");

    await expect(createFile("/v/x.md", "")).rejects.toBe(
      "파일 읽기 실패: permission denied",
    );
    expect(isFileExistsError("파일 읽기 실패: permission denied")).toBe(false);
  });
});
