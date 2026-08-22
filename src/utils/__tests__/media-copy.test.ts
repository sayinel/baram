// §297 fix (I-3) — the shared collision-resolution step for every media-save
// path. Before this file existed, `saveMediaToDocAssets` and
// `savePhotoToAssets` each wrote straight to `writeBinaryFile` with no
// conflict check, so a second file with the same generated name overwrote
// the first. This pins the actual collision behavior directly against the
// shared function both callers now go through.
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeBinaryFile = vi.fn(
  async (_path: string, _bytes: number[]) => undefined,
);
const createDir = vi.fn(async () => undefined);
const listDir = vi.fn(async () => [] as { name: string }[]);

vi.mock("../../ipc/invoke", () => ({
  writeBinaryFile: (...a: unknown[]) =>
    writeBinaryFile(...(a as [string, number[]])),
  createDir: (...a: unknown[]) => createDir(...(a as [])),
  listDir: (...a: unknown[]) => listDir(...(a as [])),
}));

import { copyBytesToDir } from "../media-copy";

describe("copyBytesToDir (§297 I-3)", () => {
  beforeEach(() => {
    writeBinaryFile.mockClear();
    createDir.mockClear();
    listDir.mockReset().mockResolvedValue([]);
  });

  it("writes under the preferred name when nothing conflicts", async () => {
    const filename = await copyBytesToDir(
      "/vault/notes/assets",
      "clip.mp4",
      new Uint8Array([1]),
    );

    expect(filename).toBe("clip.mp4");
    expect(writeBinaryFile).toHaveBeenCalledWith(
      "/vault/notes/assets/clip.mp4",
      [1],
    );
  });

  it("resolves a name collision instead of overwriting the existing file", async () => {
    listDir.mockResolvedValueOnce([{ name: "clip.mp4" }]);

    const filename = await copyBytesToDir(
      "/vault/notes/assets",
      "clip.mp4",
      new Uint8Array([2]),
    );

    expect(filename).toBe("clip-1.mp4");
    expect(writeBinaryFile).toHaveBeenCalledWith(
      "/vault/notes/assets/clip-1.mp4",
      [2],
    );
  });

  it("never writes two different payloads to the same path in one loop", async () => {
    // Reproduces the bug directly: two saves for the same preferred name,
    // back to back, the way a drop loop fires them (drop-handler.ts's
    // `for (const file of files)` doesn't await between files). Without
    // conflict resolution, both would resolve to the same path and the
    // second write clobbers the first.
    listDir.mockResolvedValue([]);
    const first = await copyBytesToDir(
      "/vault/notes/assets",
      "clip.mp4",
      new Uint8Array([1]),
    );
    // The second call's own listDir would now see the file the first call
    // just wrote — simulate that by having listDir report it from here on.
    listDir.mockResolvedValue([{ name: "clip.mp4" }]);
    const second = await copyBytesToDir(
      "/vault/notes/assets",
      "clip.mp4",
      new Uint8Array([2]),
    );

    expect(first).not.toBe(second);
    const paths = writeBinaryFile.mock.calls.map((c) => c[0]);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("still creates the directory (idempotent — createDir succeeds on an existing dir)", async () => {
    await copyBytesToDir("/vault/notes/assets", "clip.mp4", new Uint8Array());
    expect(createDir).toHaveBeenCalledWith("/vault/notes/assets");
  });

  it("falls back to no existing names when listDir fails (directory doesn't exist yet)", async () => {
    listDir.mockRejectedValueOnce(new Error("not found"));
    const filename = await copyBytesToDir(
      "/vault/notes/assets",
      "clip.mp4",
      new Uint8Array(),
    );
    expect(filename).toBe("clip.mp4");
  });
});
