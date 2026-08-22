// §297 동영상 삽입은 data URL을 만들지 않는다.
//
// ‼️ 이것은 음성 단정이다. 50MB mp4가 base64로 본문에 박히는 것을 막는 것이
// 이 경로의 핵심 요구사항이라, "무엇을 하는가"보다 "무엇을 하지 않는가"가 먼저다.
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

import { saveMediaToDocAssets } from "../media-assets";

describe("saveMediaToDocAssets (§297)", () => {
  beforeEach(() => {
    writeBinaryFile.mockClear();
    createDir.mockClear();
    listDir.mockReset().mockResolvedValue([]);
  });

  it("writes the bytes next to the document under assets/", async () => {
    const rel = await saveMediaToDocAssets(
      new Uint8Array([0, 1, 2]),
      "My Clip.MP4",
      "/vault/notes/today.md",
    );

    expect(createDir).toHaveBeenCalledWith("/vault/notes/assets");
    expect(rel.startsWith("assets/")).toBe(true);
    expect(rel.endsWith(".mp4")).toBe(true);
    // 파일명 규칙은 generatePhotoFilename과 같은 YYYYMMDD-HHmmss-{sanitized}.{ext}
    expect(rel).toMatch(/^assets\/\d{8}-\d{6}-my-clip\.mp4$/);

    const [writtenPath, writtenBytes] = writeBinaryFile.mock
      .calls[0] as unknown as [string, number[]];
    expect(writtenPath).toBe(`/vault/notes/${rel}`);
    // writeBinaryFile takes number[], not Uint8Array — the caller must convert.
    expect(writtenBytes).toEqual([0, 1, 2]);
  });

  it("never produces a data URL", async () => {
    const rel = await saveMediaToDocAssets(
      new Uint8Array([0]),
      "c.mp4",
      "/vault/a.md",
    );
    expect(rel).not.toContain("data:");
    expect(rel).not.toContain("base64");
  });

  it("rejects rather than falling back when the write fails", async () => {
    writeBinaryFile.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      saveMediaToDocAssets(new Uint8Array([0]), "c.mp4", "/vault/a.md"),
    ).rejects.toThrow("disk full");
  });

  // §297 fix (I-3): two videos with the same basename, dropped/pasted in the
  // same loop (drop-handler.ts's `for` doesn't await between files), used to
  // generate one filename each — the same second, the same sanitized name —
  // and the second write silently clobbered the first, leaving both inserted
  // nodes pointing at one file. Reproduced here rather than asserted from the
  // shared helper's own unit test: this proves the SPECIFIC caller
  // (`saveMediaToDocAssets`) is actually wired to the fix, not just that the
  // fix exists somewhere.
  it("does not clobber an existing file with the same generated name", async () => {
    // Freeze time so both calls compute the SAME preferred name from
    // generatePhotoFilename's second-granularity timestamp — reproducing
    // "same wall-clock second" deterministically rather than hoping the two
    // awaits below land in the same real second.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    try {
      const first = await saveMediaToDocAssets(
        new Uint8Array([1]),
        "clip.mp4",
        "/vault/notes/today.md",
      );
      const firstName = first.slice("assets/".length);

      // Simulate the second paste seeing the first paste's file already on disk.
      listDir.mockResolvedValueOnce([{ name: firstName }]);
      const second = await saveMediaToDocAssets(
        new Uint8Array([2]),
        "clip.mp4",
        "/vault/notes/today.md",
      );

      expect(second).not.toBe(first);
      const paths = writeBinaryFile.mock.calls.map((c) => c[0]);
      expect(new Set(paths).size).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
