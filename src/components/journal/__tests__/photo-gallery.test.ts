import { describe, expect, test } from "vitest";

import {
  filterEntriesByMedia,
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
    kind: "image",
  };
}

function makeVideo(dateStr: string): PhotoGalleryEntry {
  return {
    ...makeEntry(dateStr),
    filename: `clip-${dateStr}.mp4`,
    relativePath: `journal/assets/2026-03/clip-${dateStr}.mp4`,
    absolutePath: `/root/journal/assets/2026-03/clip-${dateStr}.mp4`,
    kind: "video-file",
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

// §56d 매체 필터. 그룹 개수와 라이트박스의 좌우 이동 목록이 화면과 어긋나지 않으려면
// 이 걸러내기가 `groupPhotosByDate` **앞**에 있어야 한다 — 패널이 그 순서로 부른다.
describe("filterEntriesByMedia", () => {
  const entries: PhotoGalleryEntry[] = [
    makeEntry("2026-03-01"),
    makeVideo("2026-03-02"),
    makeEntry("2026-03-03"),
  ];

  test("all keeps everything, in the order it was given", () => {
    expect(filterEntriesByMedia(entries, "all")).toEqual(entries);
  });

  test("photo drops the clips", () => {
    expect(
      filterEntriesByMedia(entries, "photo").map((e) => e.filename),
    ).toEqual(["photo-2026-03-01.jpg", "photo-2026-03-03.jpg"]);
  });

  test("video keeps only the clips", () => {
    expect(
      filterEntriesByMedia(entries, "video").map((e) => e.filename),
    ).toEqual(["clip-2026-03-02.mp4"]);
  });

  // ‼️ `video-embed`는 assets/ 스캔으로는 나올 수 없지만, "image가 아니면 video"라는
  // 판정을 쓰는 곳이 이미 셋이다(insertMediaAtPos·NodeView·여기). 세 곳이 같은 답을
  // 내야 하므로 도달 불가능한 멤버에도 같은 규칙을 적용한다 — 나중에 갤러리가 문서를
  // 스캔하게 되면 그때 조용히 어느 필터에도 안 걸리는 항목이 되는 것이 최악이다.
  test("an embed counts as video, matching insertMediaAtPos's rule", () => {
    const embed: PhotoGalleryEntry = {
      ...makeEntry("2026-03-04"),
      kind: "video-embed",
    };

    expect(filterEntriesByMedia([embed], "video")).toEqual([embed]);
    expect(filterEntriesByMedia([embed], "photo")).toEqual([]);
  });

  test("grouping the filtered list is what makes the counts agree with the grid", () => {
    const groups = groupPhotosByDate(
      filterEntriesByMedia(entries, "photo"),
      "month",
    );

    expect(groups.get("2026-03")?.length).toBe(2);
  });
});
