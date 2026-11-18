// §56d Photo Gallery 썸네일 URL 해결 — 캐시·인플라이트 공유·원본 폴백.
import { beforeEach, describe, expect, test, vi } from "vitest";

const photoThumbnail = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));
vi.mock("../../ipc/thumbnail", () => ({
  photoThumbnail: (path: string, maxPx: number) =>
    photoThumbnail(path, maxPx) as Promise<string>,
}));

const { _resetThumbCache, cachedThumbUrl, GALLERY_THUMB_PX, resolveThumbUrl } =
  await import("../journal/photo-thumbnail");

describe("resolveThumbUrl", () => {
  beforeEach(() => {
    _resetThumbCache();
    photoThumbnail.mockReset();
  });

  test("returns the cached thumbnail's asset URL, not the original's", async () => {
    photoThumbnail.mockResolvedValue("/cache/thumbnails/abc.jpg");

    const result = await resolveThumbUrl("/vault/assets/photo.jpg");

    expect(result).toEqual({
      url: "asset://localhost//cache/thumbnails/abc.jpg",
      isOriginal: false,
    });
    expect(photoThumbnail).toHaveBeenCalledWith(
      "/vault/assets/photo.jpg",
      GALLERY_THUMB_PX,
    );
  });

  test("asks the backend once per path+size, however many callers ask", async () => {
    photoThumbnail.mockResolvedValue("/cache/thumbnails/abc.jpg");

    // 그리드와 라이트박스가 같은 사진을 동시에 요청하는 경우.
    const [a, b] = await Promise.all([
      resolveThumbUrl("/vault/assets/photo.jpg"),
      resolveThumbUrl("/vault/assets/photo.jpg"),
    ]);
    // 해결된 뒤의 재요청.
    const c = await resolveThumbUrl("/vault/assets/photo.jpg");

    expect(photoThumbnail).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  test("a different size is a different request", async () => {
    photoThumbnail.mockImplementation((_p: string, px: number) =>
      Promise.resolve(`/cache/thumbnails/${px}.jpg`),
    );

    await resolveThumbUrl("/vault/assets/photo.jpg", 320);
    await resolveThumbUrl("/vault/assets/photo.jpg", 2048);

    expect(photoThumbnail).toHaveBeenCalledTimes(2);
  });

  test("falls back to the original when the backend cannot decode it", async () => {
    photoThumbnail.mockRejectedValue("썸네일을 만들 수 없는 이미지입니다");

    const result = await resolveThumbUrl("/vault/assets/logo.svg");

    expect(result).toEqual({
      url: "asset://localhost//vault/assets/logo.svg",
      isOriginal: true,
    });
  });

  test("does not retry a failure on every scroll past the same photo", async () => {
    photoThumbnail.mockRejectedValue("nope");

    await resolveThumbUrl("/vault/assets/logo.svg");
    await resolveThumbUrl("/vault/assets/logo.svg");

    expect(photoThumbnail).toHaveBeenCalledTimes(1);
  });

  /** 위 시험과 짝이다. 거절의 이유가 **권한**이면 기억하지 않는다 — 지금 열린 context 에 대한 답이라
   *  사용자가 그 폴더를 열면 바뀐다. 이것을 실패시키는 것: 권한 거절도 `remember` 하는 것(폴더를 연
   *  뒤에도 다시 그린 이미지가 캐시에서 원본을 꺼낸다). */
  test("asks again after a refusal no open context covers", async () => {
    photoThumbnail.mockRejectedValueOnce("THUMBNAIL_NOT_AUTHORIZED");
    photoThumbnail.mockResolvedValueOnce("/cache/thumbnails/abc.jpg");

    expect(await resolveThumbUrl("/notes/photo.jpg", 2048)).toEqual({
      url: "asset://localhost//notes/photo.jpg",
      isOriginal: true,
    });
    expect(cachedThumbUrl("/notes/photo.jpg", 2048)).toBeNull();

    expect(await resolveThumbUrl("/notes/photo.jpg", 2048)).toEqual({
      url: "asset://localhost//cache/thumbnails/abc.jpg",
      isOriginal: false,
    });
    expect(photoThumbnail).toHaveBeenCalledTimes(2);
  });

  test("cachedThumbUrl is empty until resolved, then synchronous", async () => {
    photoThumbnail.mockResolvedValue("/cache/thumbnails/abc.jpg");

    expect(cachedThumbUrl("/vault/assets/photo.jpg")).toBeNull();
    await resolveThumbUrl("/vault/assets/photo.jpg");

    expect(cachedThumbUrl("/vault/assets/photo.jpg")).toEqual({
      url: "asset://localhost//cache/thumbnails/abc.jpg",
      isOriginal: false,
    });
  });
});
