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

  it("resolves a collision across two SEQUENTIAL calls, which is the contract a caller gets by awaiting each one", async () => {
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

  // §297 fix (I-3 concurrency, final-gate Important #1): the previous version
  // of this test was named "never writes two different payloads to the same
  // path in one loop" and claimed in its own comment to reproduce
  // drop-handler.ts's un-awaited loop — but it actually awaited the first
  // call to completion before starting the second, which is the sequential
  // case above, not a loop. This test names and pins the ACTUAL, narrower
  // contract honestly: copyBytesToDir does NOT protect against two calls
  // that are genuinely in flight at once — each one reads its own listDir
  // snapshot independently, so both can resolve to the same name. That is
  // exactly why the real fix lives one level up, in drop-handler.ts's loops
  // (now sequential — see drop-handler-concurrency.test.ts for the test that
  // proves no clobber AT THAT LEVEL, which is where the guarantee actually
  // needs to hold).
  it("does NOT protect two genuinely concurrent calls from colliding — serializing them is the caller's job", async () => {
    listDir.mockResolvedValue([]); // both calls see the same empty snapshot
    const [first, second] = await Promise.all([
      copyBytesToDir("/vault/notes/assets", "clip.mp4", new Uint8Array([1])),
      copyBytesToDir("/vault/notes/assets", "clip.mp4", new Uint8Array([2])),
    ]);

    expect(first).toBe("clip.mp4");
    expect(second).toBe("clip.mp4");
    expect(writeBinaryFile).toHaveBeenCalledWith(
      "/vault/notes/assets/clip.mp4",
      [1],
    );
    expect(writeBinaryFile).toHaveBeenCalledWith(
      "/vault/notes/assets/clip.mp4",
      [2],
    );
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
