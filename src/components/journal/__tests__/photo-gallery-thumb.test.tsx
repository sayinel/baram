// §56d 갤러리 한 칸이 **원본을 <img>에 걸지 않는다**는 것을 지키는 테스트.
//
// 이 규칙이 이 기능의 전부다. 원본을 걸면 100px 칸에 그리려는 것이라도 브라우저가 원본을
// 통째로 디코드한다 — 실측 저널은 사진 177장 평균 17.7 MPix로, 그 디코드 합이 RGBA 12.2GB다
// (유휴 메모리 목표 100MB). "일단 원본, 준비되면 교체"는 그 디코드를 그대로 치르는 것이라
// 완화가 아니다. 그래서 확인하는 것은 "썸네일이 결국 뜬다"가 아니라 "그 전에 img가 없다"다.

import type { PhotoGalleryEntry } from "../../../utils/journal/journal-photo";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
const { _resetThumbCache, formatClipDuration } =
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
  kind: "image",
  relativePath: "assets/20260805-101500-a.jpg",
};

const CLIP: PhotoGalleryEntry = {
  absolutePath: "/vault/journal/daily/2026/08/assets/20260805-102000-c.mp4",
  caption: "파도",
  date: new Date(2026, 7, 5),
  dateFromFilename: true,
  filename: "20260805-102000-c.mp4",
  journalPath: "/vault/journal/daily/2026/08/2026-08-05.md",
  kind: "video-file",
  relativePath: "assets/20260805-102000-c.mp4",
};

/** 화면에 들어온 것으로 만들고, idle 큐가 흐르게 한다.
 *
 * ‼️ `act`의 블록 본문이어야 한다. 축약 화살표로 쓰면 반환값이 그대로 넘어가 스코프가
 * 오염되고 **같은 파일의 이후 렌더가 전부** 죽는다. 동영상 칸은 idle 콜백 안에서
 * 동기로 setState하므로(사진 칸은 그다음 promise에서 한다) 이 감싸기가 필요하다. */
async function scrollIntoView() {
  await act(async () => {
    MockIntersectionObserver.instances.at(-1)!.triggerIntersect();
    await vi.runAllTimersAsync();
  });
}

/** `waitFor`는 **throw**에만 재시도한다 — querySelector가 주는 null은 그대로 통과해
 *  단정이 엉뚱한 줄에서 죽는다. */
async function waitForVideo(container: HTMLElement): Promise<HTMLVideoElement> {
  return waitFor(() => {
    const el = container.querySelector("video");
    if (!el) throw new Error("<video> not mounted yet");
    return el;
  });
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

// §293 동영상 칸. 사진 칸과 다른 점이 둘 있고, 둘 다 겉보기가 아니라 원리다.
describe("PhotoGalleryThumb — video clip", () => {
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

  // ‼️ Rust `photo_thumbnail`은 `image` crate이라 mp4를 디코드할 수 없다. 부르면
  // 반드시 실패하고, 실패 경로는 **일부러 시끄럽게** 만들어져 있다 — console.warn을
  // 찍고 원본 URL로 폴백한다(photo-thumbnail.ts). 동영상에 그 길을 태우면 클립마다
  // 경고가 찍히고 그 URL이 <img>에 걸려 깨진 아이콘이 된다. 부르지 않는 것이 답이다.
  test("never asks the backend to thumbnail a clip", async () => {
    const { container } = render(
      <PhotoGalleryThumb onOpen={vi.fn()} photo={CLIP} />,
    );

    await scrollIntoView();
    await waitForVideo(container);

    expect(photoThumbnail).not.toHaveBeenCalled();
  });

  test("mounts nothing until the cell is on screen", () => {
    const { container } = render(
      <PhotoGalleryThumb onOpen={vi.fn()} photo={CLIP} />,
    );

    // 한 달치 <video>를 한꺼번에 걸면 디코더가 그만큼 잡히고 moov 요청이 큐에 쌓인다 —
    // 썸네일이 이미 배운 교훈을 동영상에서 다시 치를 이유가 없다.
    expect(container.querySelector("video")).toBeNull();
  });

  test("points the poster at the clip itself, seeked past frame zero", async () => {
    const { container } = render(
      <PhotoGalleryThumb onOpen={vi.fn()} photo={CLIP} />,
    );

    await scrollIntoView();

    const video = await waitForVideo(container);
    // #t=0.1 — moov atom + 첫 프레임만 받아 포스터로 쓴다 (§17.2-7, video-view.tsx와 동일).
    expect(video.getAttribute("src")).toBe(
      `asset://localhost/${CLIP.absolutePath}#t=0.1`,
    );
    expect(video.getAttribute("preload")).toBe("metadata");
    // 칸은 라이트박스를 여는 버튼이다 — 여기서 재생하지 않는다.
    expect(video.hasAttribute("controls")).toBe(false);
  });

  test("hovering a clip warms nothing — there is no preview to build", async () => {
    render(<PhotoGalleryThumb onOpen={vi.fn()} photo={CLIP} />);
    await scrollIntoView();

    fireEvent.mouseEnter(screen.getByTitle("파도"));

    expect(photoThumbnail).not.toHaveBeenCalled();
  });

  test("shows the clip's length once the webview reports it", async () => {
    const { container } = render(
      <PhotoGalleryThumb onOpen={vi.fn()} photo={CLIP} />,
    );
    await scrollIntoView();
    const video = await waitForVideo(container);

    // jsdom은 미디어를 디코드하지 않아 duration이 NaN이다 — 웹뷰가 metadata를 읽고
    // 나서의 상태를 합성해 주입한다. 실제 재생은 실앱에서만 확인된다.
    Object.defineProperty(video, "duration", { configurable: true, value: 14 });
    fireEvent.loadedMetadata(video);

    expect(screen.getByText("0:14")).toBeTruthy();
  });

  test("stays silent when the webview cannot say how long the clip is", async () => {
    const { container } = render(
      <PhotoGalleryThumb onOpen={vi.fn()} photo={CLIP} />,
    );
    await scrollIntoView();
    const video = await waitForVideo(container);

    // 실측되는 값들이다: 아직 못 읽었으면 NaN, 길이를 모르는 스트림이면 Infinity.
    // 배지에 "NaN:aN"이 뜨는 것보다 배지가 없는 편이 낫다.
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: NaN,
    });
    fireEvent.loadedMetadata(video);
    expect(container.querySelector(".photo-gallery-duration")).toBeNull();

    Object.defineProperty(video, "duration", {
      configurable: true,
      value: Infinity,
    });
    fireEvent.loadedMetadata(video);
    expect(container.querySelector(".photo-gallery-duration")).toBeNull();
  });
});

describe("formatClipDuration", () => {
  test("pads the seconds so 1:02 never reads as 1:2", () => {
    expect(formatClipDuration(62)).toBe("1:02");
  });

  test("drops sub-second precision rather than rounding up past the end", () => {
    expect(formatClipDuration(14.9)).toBe("0:14");
  });

  test("grows an hours field instead of showing 62:05", () => {
    expect(formatClipDuration(3725)).toBe("1:02:05");
  });

  test("returns null for the values a webview actually reports before it knows", () => {
    expect(formatClipDuration(NaN)).toBeNull();
    expect(formatClipDuration(Infinity)).toBeNull();
    expect(formatClipDuration(0)).toBeNull();
  });
});
