import { describe, test, expect } from "vitest";
import { generatePhotoFilename, getAssetsDir, isJournalPhoto } from "../journal-photo";

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
});
