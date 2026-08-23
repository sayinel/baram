// §56d 라이트박스는 원본을 걸지 않고 2048px 프리뷰를 그린다. 프리뷰가 오기 전에는 이미
// 캐시된 그리드 썸네일을 늘려 채우므로 화면이 비지 않는다.

import type { PhotoGalleryEntry } from "../../../utils/journal/journal-photo";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const photoThumbnail = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));
vi.mock("../../../ipc/thumbnail", () => ({
  photoThumbnail: (path: string, maxPx: number) =>
    photoThumbnail(path, maxPx) as Promise<string>,
}));

const { PhotoLightbox } = await import("../PhotoLightbox");
const { _resetThumbCache, GALLERY_THUMB_PX, resolveThumbUrl } =
  await import("../../../utils/journal/photo-thumbnail");

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

function renderLightbox(
  overrides: Partial<{
    onClose: () => void;
    onNavigate: (d: "next" | "prev") => void;
    photo: PhotoGalleryEntry;
  }> = {},
) {
  return render(
    <PhotoLightbox
      onClose={overrides.onClose ?? vi.fn()}
      onNavigate={overrides.onNavigate ?? vi.fn()}
      onOpenJournal={vi.fn()}
      photo={overrides.photo ?? PHOTO}
    />,
  );
}

describe("PhotoLightbox", () => {
  beforeEach(() => {
    _resetThumbCache();
    photoThumbnail.mockReset();
  });

  test("asks for a 2048px preview, not the original", async () => {
    photoThumbnail.mockResolvedValue("/cache/thumbnails/big.jpg");
    renderLightbox();

    const img = await waitFor(() => screen.getByRole("img"));
    expect(photoThumbnail).toHaveBeenCalledWith(PHOTO.absolutePath, 2048);
    expect(img.getAttribute("src")).toBe(
      "asset://localhost//cache/thumbnails/big.jpg",
    );
    expect(img.className).toBe("photo-lightbox-img");
  });

  test("stretches the already-cached grid thumbnail while the preview is built", async () => {
    // 사용자는 보이는 칸을 눌러서 여기 왔다 — 그 칸의 썸네일은 이미 캐시에 있다.
    photoThumbnail.mockResolvedValue("/cache/thumbnails/small.jpg");
    await resolveThumbUrl(PHOTO.absolutePath, GALLERY_THUMB_PX);

    let releasePreview: (path: string) => void = () => {};
    photoThumbnail.mockImplementation(
      () => new Promise<string>((resolve) => (releasePreview = resolve)),
    );
    renderLightbox();

    // 프리뷰가 오기 전: 썸네일을 늘려 놓았고, 늘렸다는 표시가 붙어 있다.
    const placeholder = screen.getByRole("img");
    expect(placeholder.getAttribute("src")).toBe(
      "asset://localhost//cache/thumbnails/small.jpg",
    );
    expect(placeholder.className.split(" ")).toContain(
      "photo-lightbox-img-placeholder",
    );

    releasePreview("/cache/thumbnails/big.jpg");

    await waitFor(() =>
      expect(screen.getByRole("img").getAttribute("src")).toBe(
        "asset://localhost//cache/thumbnails/big.jpg",
      ),
    );
    expect(screen.getByRole("img").className).toBe("photo-lightbox-img");
  });

  test("keeps a way to the original — the preview is not the only thing on offer", async () => {
    photoThumbnail.mockResolvedValue("/cache/thumbnails/big.jpg");
    renderLightbox();
    await waitFor(() => screen.getByRole("img"));

    fireEvent.click(screen.getByText("원본 보기"));

    // 원본 보기는 프리뷰 캐시가 아니라 사진 파일 자체를 가리켜야 한다.
    const original = screen
      .getAllByRole("img", { hidden: true })
      .find(
        (el) =>
          el.getAttribute("src") === `asset://localhost/${PHOTO.absolutePath}`,
      );
    expect(original).toBeTruthy();
  });

  test("Escape closes only the top layer — the lightbox stays open under it", async () => {
    const onClose = vi.fn();
    photoThumbnail.mockResolvedValue("/cache/thumbnails/big.jpg");
    renderLightbox({ onClose });
    await waitFor(() => screen.getByRole("img"));
    fireEvent.click(screen.getByText("원본 보기"));

    fireEvent.keyDown(window, { key: "Escape" });

    // 원본 보기만 닫힌다. 라이트박스까지 닫히면 사진 목록으로 튕겨 나간다.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("Close")).toBeNull();

    // 그다음 Esc가 라이트박스를 닫는다.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("does not navigate the gallery while an original is being inspected", async () => {
    const onNavigate = vi.fn();
    photoThumbnail.mockResolvedValue("/cache/thumbnails/big.jpg");
    renderLightbox({ onNavigate });
    await waitFor(() => screen.getByRole("img"));

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith("next");

    fireEvent.click(screen.getByText("원본 보기"));
    onNavigate.mockClear();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

// §293 라이트박스의 동영상. 사진 경로와 공유하는 것은 껍데기(오버레이·좌우·닫기·일기 보기)
// 뿐이고, 안쪽은 다른 계약이다.
describe("PhotoLightbox — video clip", () => {
  beforeEach(() => {
    _resetThumbCache();
    photoThumbnail.mockReset();
  });

  test("plays the file itself instead of asking for a preview that cannot exist", () => {
    const { container } = renderLightbox({ photo: CLIP });

    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toBe(
      `asset://localhost/${CLIP.absolutePath}`,
    );
    expect(video?.hasAttribute("controls")).toBe(true);
    // 그리드 칸과 달리 `#t=0.1`을 붙이지 않는다 — 여기서는 처음부터 재생해야 한다.
    expect(video?.getAttribute("src")).not.toContain("#t=");
    expect(photoThumbnail).not.toHaveBeenCalled();
  });

  // "원본 보기"는 2048px 프리뷰 대신 원본 사진을 여는 버튼이다(ImageOriginalView는
  // 이미지 뷰어다). 동영상에는 프리뷰라는 중간 단계가 없어 이 화면이 이미 원본이다 —
  // 버튼을 남겨 두면 누르는 순간 <img>에 mp4가 걸려 깨진 아이콘이 뜬다.
  test("offers no 원본 보기 — this screen already is the original", () => {
    renderLightbox({ photo: CLIP });

    expect(screen.queryByText("원본 보기")).toBeNull();
  });

  // 사용자는 이 칸을 **눌러서** 여기 왔다 — 그 클릭이 곧 재생 의사다. WebKit의 자동재생
  // 정책도 사용자 제스처에서 출발한 재생은 허용한다. 막히더라도 컨트롤이 그대로 있다.
  test("starts playing rather than waiting for a second click", () => {
    const { container } = renderLightbox({ photo: CLIP });

    expect(container.querySelector("video")?.hasAttribute("autoplay")).toBe(
      true,
    );
  });

  test("still offers the way back to the journal", () => {
    renderLightbox({ photo: CLIP });

    expect(screen.getByText("일기 보기")).toBeTruthy();
  });

  // ‼️ `<video controls>`의 네이티브 컨트롤도 좌우 화살표로 탐색한다. 창 전체에 걸린
  // 리스너가 그대로 듣고 있으면 10초 되감기와 "다음 항목으로 이동"이 **동시에** 일어난다.
  test("arrow keys inside the player scrub it — they do not skip to the next clip", () => {
    const onNavigate = vi.fn();
    const { container } = renderLightbox({ onNavigate, photo: CLIP });

    fireEvent.keyDown(container.querySelector("video")!, { key: "ArrowRight" });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  test("arrow keys outside the player still move through the gallery", () => {
    const onNavigate = vi.fn();
    renderLightbox({ onNavigate, photo: CLIP });

    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(onNavigate).toHaveBeenCalledWith("next");
  });

  // Esc는 재생 중에도 닫혀야 한다 — 동영상이 열려 있다고 갇히면 안 된다.
  test("Escape closes the lightbox even from inside the player", () => {
    const onClose = vi.fn();
    const { container } = renderLightbox({ onClose, photo: CLIP });

    fireEvent.keyDown(container.querySelector("video")!, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
