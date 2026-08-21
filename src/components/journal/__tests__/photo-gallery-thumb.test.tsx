// §56d 갤러리 한 칸이 **원본을 <img>에 걸지 않는다**는 것을 지키는 테스트.
//
// 이 규칙이 이 기능의 전부다. 원본을 걸면 100px 칸에 그리려는 것이라도 브라우저가 원본을
// 통째로 디코드한다 — 실측 저널은 사진 177장 평균 17.7 MPix로, 그 디코드 합이 RGBA 12.2GB다
// (유휴 메모리 목표 100MB). "일단 원본, 준비되면 교체"는 그 디코드를 그대로 치르는 것이라
// 완화가 아니다. 그래서 확인하는 것은 "썸네일이 결국 뜬다"가 아니라 "그 전에 img가 없다"다.

import type { PhotoGalleryEntry } from "../../../utils/journal/journal-photo";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const photoThumbnail = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));
vi.mock("../../../ipc/thumbnail", () => ({
  photoThumbnail: (path: string, maxPx: number) =>
    photoThumbnail(path, maxPx) as Promise<string>,
}));

const { PhotoGalleryThumb } = await import("../PhotoGalleryThumb");
const { _resetForTest } =
  await import("../../../extensions/nodes/views/lazy-visible");
const { _resetThumbCache } =
  await import("../../../utils/journal/photo-thumbnail");

declare const MockIntersectionObserver: {
  instances: {
    elements: Set<Element>;
    triggerIntersect: (v?: boolean) => void;
  }[];
};

const PHOTO: PhotoGalleryEntry = {
  absolutePath: "/vault/journal/daily/2026/08/assets/20260805-101500-a.jpg",
  caption: "첫 물놀이",
  date: new Date(2026, 7, 5),
  dateFromFilename: true,
  filename: "20260805-101500-a.jpg",
  journalPath: "/vault/journal/daily/2026/08/2026-08-05.md",
  relativePath: "assets/20260805-101500-a.jpg",
};

/** 화면에 들어온 것으로 만들고, idle 큐가 흐르게 한다. */
async function scrollIntoView() {
  MockIntersectionObserver.instances.at(-1)!.triggerIntersect();
  await vi.runAllTimersAsync();
}

describe("PhotoGalleryThumb", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    _resetForTest();
    _resetThumbCache();
    photoThumbnail.mockReset();
    photoThumbnail.mockResolvedValue("/cache/thumbnails/abc.jpg");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("renders no <img> at all before the thumbnail is ready", () => {
    render(<PhotoGalleryThumb onOpen={vi.fn()} photo={PHOTO} />);

    expect(screen.queryByRole("img")).toBeNull();
    // 캡션은 사진을 기다리지 않는다.
    expect(screen.getByText("첫 물놀이")).toBeTruthy();
  });

  test("does not ask for a thumbnail until the cell is on screen", () => {
    render(<PhotoGalleryThumb onOpen={vi.fn()} photo={PHOTO} />);

    expect(photoThumbnail).not.toHaveBeenCalled();
  });

  test("shows the cached thumbnail — never the original — once visible", async () => {
    render(<PhotoGalleryThumb onOpen={vi.fn()} photo={PHOTO} />);

    await scrollIntoView();

    const img = await waitFor(() => screen.getByRole("img"));
    expect(img.getAttribute("src")).toBe(
      "asset://localhost//cache/thumbnails/abc.jpg",
    );
    expect(img.getAttribute("src")).not.toContain(PHOTO.absolutePath);
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("data-thumb-source")).toBe("cache");
  });

  test("warms the lightbox-sized preview when the cell is hovered", async () => {
    render(<PhotoGalleryThumb onOpen={vi.fn()} photo={PHOTO} />);
    await scrollIntoView();
    photoThumbnail.mockClear();

    // 클릭하기 전에 마우스가 먼저 올라간다 — 그 사이에 라이트박스가 쓸 크기를 만들어 두면
    // 흐린 자리표시가 보이지 않는다.
    fireEvent.mouseEnter(screen.getByTitle("첫 물놀이"));

    expect(photoThumbnail).toHaveBeenCalledWith(PHOTO.absolutePath, 2048);
  });

  test("falls back to the original only when the backend cannot decode it", async () => {
    // svg처럼 래스터가 아닌 파일. 폴백이 없으면 갤러리에 빈 칸이 남는다.
    photoThumbnail.mockRejectedValue("썸네일을 만들 수 없는 이미지입니다");
    render(<PhotoGalleryThumb onOpen={vi.fn()} photo={PHOTO} />);

    await scrollIntoView();

    const img = await waitFor(() => screen.getByRole("img"));
    expect(img.getAttribute("src")).toBe(
      `asset://localhost/${PHOTO.absolutePath}`,
    );
    // 이 표식이 개발자 도구에서 "고쳐졌는데 그대로다"와 "폴백으로 원본을 그리고 있다"를
    // 가른다 — 두 경우의 화면이 똑같기 때문에 필요하다.
    expect(img.getAttribute("data-thumb-source")).toBe("original");
  });
});
