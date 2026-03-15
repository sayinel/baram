import { describe, expect, test } from "vitest";

import {
  groupPhotosByDate,
  type PhotoGalleryEntry,
} from "../../../utils/journal/journal-photo";

function makeEntry(dateStr: string, caption = ""): PhotoGalleryEntry {
  return {
    filename: `photo-${dateStr}.jpg`,
    relativePath: `journal/assets/2026-03/photo-${dateStr}.jpg`,
    absolutePath: `/root/journal/assets/2026-03/photo-${dateStr}.jpg`,
    date: new Date(dateStr),
    dateFromFilename: true,
    caption,
    journalPath: null,
  };
}

describe("groupPhotosByDate", () => {
  const photos: PhotoGalleryEntry[] = [
    makeEntry("2026-03-01"),
    makeEntry("2026-03-01"),
    makeEntry("2026-03-15"),
    makeEntry("2026-02-10"),
    makeEntry("2025-12-25"),
  ];

  test("groups by day", () => {
    const groups = groupPhotosByDate(photos, "day");
    expect(groups.size).toBe(4);
    expect(groups.get("2026-03-01")?.length).toBe(2);
    expect(groups.get("2026-03-15")?.length).toBe(1);
    expect(groups.get("2026-02-10")?.length).toBe(1);
    expect(groups.get("2025-12-25")?.length).toBe(1);
  });

  test("groups by month", () => {
    const groups = groupPhotosByDate(photos, "month");
    expect(groups.size).toBe(3);
    expect(groups.get("2026-03")?.length).toBe(3);
    expect(groups.get("2026-02")?.length).toBe(1);
    expect(groups.get("2025-12")?.length).toBe(1);
  });

  test("groups by year", () => {
    const groups = groupPhotosByDate(photos, "year");
    expect(groups.size).toBe(2);
    expect(groups.get("2026")?.length).toBe(4);
    expect(groups.get("2025")?.length).toBe(1);
  });

  test("handles empty array", () => {
    const groups = groupPhotosByDate([], "day");
    expect(groups.size).toBe(0);
  });
});
