// §297 동영상 삽입은 data URL을 만들지 않는다.
//
// ‼️ 이것은 음성 단정이다. 50MB mp4가 base64로 본문에 박히는 것을 막는 것이
// 이 경로의 핵심 요구사항이라, "무엇을 하는가"보다 "무엇을 하지 않는가"가 먼저다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeBinaryFile = vi.fn(async () => undefined);
const createDir = vi.fn(async () => undefined);

vi.mock("../../ipc/invoke", () => ({
  writeBinaryFile: (...a: unknown[]) => writeBinaryFile(...(a as [])),
  createDir: (...a: unknown[]) => createDir(...(a as [])),
  listDir: vi.fn(async () => []),
}));

import { saveMediaToDocAssets } from "../media-assets";

describe("saveMediaToDocAssets (§297)", () => {
  beforeEach(() => {
    writeBinaryFile.mockClear();
    createDir.mockClear();
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
});
