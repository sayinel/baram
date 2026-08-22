import { beforeEach, describe, expect, it, test, vi } from "vitest";

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
  readFile: vi.fn(),
}));

import {
  generatePhotoFilename,
  getAssetsDir,
  isJournalPhoto,
  savePhotoToAssets,
} from "../journal/journal-photo";

describe("journal-photo utilities", () => {
  const fixedDate = new Date(2026, 2, 1, 14, 30, 22); // 2026-03-01 14:30:22

  describe("generatePhotoFilename", () => {
    test("generates YYYYMMDD-HHmmss-name.ext format", () => {
      const result = generatePhotoFilename("cafe.jpg", fixedDate);
      expect(result).toBe("20260301-143022-cafe.jpg");
    });

    test("sanitizes special characters", () => {
      const result = generatePhotoFilename("My Photo (2).PNG", fixedDate);
      expect(result).toBe("20260301-143022-my-photo-2.png");
    });

    test("handles filenames without extension", () => {
      const result = generatePhotoFilename("screenshot", fixedDate);
      expect(result).toBe("20260301-143022-screenshot.jpg");
    });

    test("truncates long filenames", () => {
      const longName = "a".repeat(100) + ".png";
      const result = generatePhotoFilename(longName, fixedDate);
      expect(result.length).toBeLessThan(80);
      expect(result).toMatch(/\.png$/);
    });

    test("handles Korean filenames", () => {
      const result = generatePhotoFilename("카페사진.jpg", fixedDate);
      expect(result).toBe("20260301-143022-카페사진.jpg");
    });

    // §297 보안 리뷰 Low: 확장자에 path traversal이 섞여 들어와도(오늘의 호출부에서는
    // 도달 불가능하지만, 이 함수 자신은 그 문지기에 기대지 않아야 한다) 최종 파일명이
    // 디렉터리를 벗어나는 세그먼트를 절대 담지 않는다 — 허용목록을 통과 못 하면 `jpg`로
    // 떨어진다.
    test("falls back to jpg when the extension contains a path separator", () => {
      const result = generatePhotoFilename(
        "photo.../../../etc/passwd",
        fixedDate,
      );
      expect(result).toBe("20260301-143022-photo.jpg");
      expect(result).not.toContain("/");
      expect(result).not.toContain("..");
    });

    test("falls back to jpg when the extension has non-alphanumeric characters", () => {
      const result = generatePhotoFilename("file.a!b", fixedDate);
      expect(result.endsWith(".jpg")).toBe(true);
    });

    test("falls back to jpg when the extension is longer than 10 characters", () => {
      const result = generatePhotoFilename("file." + "a".repeat(11), fixedDate);
      expect(result.endsWith(".jpg")).toBe(true);
    });

    test("keeps a normal long-ish but valid extension (boundary: 10 chars)", () => {
      const result = generatePhotoFilename("file." + "a".repeat(10), fixedDate);
      expect(result.endsWith(`.${"a".repeat(10)}`)).toBe(true);
    });
  });

  describe("getAssetsDir", () => {
    test("generates assets/YYYY-MM path", () => {
      expect(getAssetsDir("journal", fixedDate)).toBe("journal/assets/2026-03");
    });

    test("pads month with zero", () => {
      const jan = new Date(2026, 0, 15);
      expect(getAssetsDir("my-journal", jan)).toBe("my-journal/assets/2026-01");
    });
  });

  describe("isJournalPhoto", () => {
    test("detects assets path pattern", () => {
      expect(isJournalPhoto("assets/2026-03/photo.jpg")).toBe(true);
      expect(isJournalPhoto("journal/assets/2026-01/img.png")).toBe(true);
    });

    test("rejects non-assets paths", () => {
      expect(isJournalPhoto("images/photo.jpg")).toBe(false);
      expect(isJournalPhoto("assets/photo.jpg")).toBe(false);
    });
  });

  // §297 fix (I-3): savePhotoToAssets predates video and shared the same
  // no-conflict-resolution flaw saveMediaToDocAssets had — both now go
  // through copyBytesToDir. Pinned here directly against this call site too,
  // not just the shared helper's own test, so a future refactor that
  // accidentally un-wires this one is still caught.
  describe("savePhotoToAssets (§297 I-3)", () => {
    beforeEach(() => {
      writeBinaryFile.mockClear();
      createDir.mockClear();
      listDir.mockReset().mockResolvedValue([]);
    });

    it("writes under assets/ relative to the active file", async () => {
      const rel = await savePhotoToAssets(
        new Uint8Array([1]),
        "photo.jpg",
        "/vault",
        "daily",
        "/vault/daily/2026-01-01.md",
      );
      expect(rel.startsWith("assets/")).toBe(true);
      expect(createDir).toHaveBeenCalledWith("/vault/daily/assets");
    });

    it("does not clobber an existing photo with the same generated name", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
      try {
        const first = await savePhotoToAssets(
          new Uint8Array([1]),
          "photo.jpg",
          "/vault",
          "daily",
          "/vault/daily/2026-01-01.md",
        );
        const firstName = first.slice("assets/".length);

        listDir.mockResolvedValueOnce([{ name: firstName }]);
        const second = await savePhotoToAssets(
          new Uint8Array([2]),
          "photo.jpg",
          "/vault",
          "daily",
          "/vault/daily/2026-01-01.md",
        );

        expect(second).not.toBe(first);
        const paths = writeBinaryFile.mock.calls.map((c) => c[0]);
        expect(new Set(paths).size).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
