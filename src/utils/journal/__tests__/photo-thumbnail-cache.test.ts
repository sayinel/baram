// §56d The session's thumbnail cache (issue 793): keyed by the file's revision, so a photo
// replaced at the same path is asked for again, and bounded, so it does not grow for the
// life of the process.

import { beforeEach, describe, expect, test, vi } from "vitest";

const photoThumbnail = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));
vi.mock("../../../ipc/thumbnail", () => ({
  photoThumbnail: (path: string, maxPx: number) =>
    photoThumbnail(path, maxPx) as Promise<string>,
}));

const {
  _resetThumbCache,
  _thumbCacheSizes,
  cachedThumbUrl,
  MAX_RESOLVED_THUMBS,
  MAX_THUMB_FAILURES,
  resolveThumbUrl,
} = await import("../photo-thumbnail");

describe("thumbnail session cache", () => {
  beforeEach(() => {
    _resetThumbCache();
    photoThumbnail.mockReset();
    photoThumbnail.mockImplementation((path: string) =>
      Promise.resolve(`/cache/${path}`),
    );
  });

  /** 이것을 실패시키는 것: `cachedThumbUrl` 이 revision 을 비교하지 않는 것. */
  test("a new revision of the same path is asked for again and replaces the old one", async () => {
    await resolveThumbUrl("/v/a.jpg", 320, "1:10");
    expect(cachedThumbUrl("/v/a.jpg", 320, "1:10")).not.toBeNull();
    expect(cachedThumbUrl("/v/a.jpg", 320, "2:20")).toBeNull();

    await resolveThumbUrl("/v/a.jpg", 320, "2:20");
    expect(photoThumbnail).toHaveBeenCalledTimes(2);
    expect(cachedThumbUrl("/v/a.jpg", 320, "1:10")).toBeNull();
    expect(_thumbCacheSizes().resolved).toBe(1);
  });

  /** 이것을 실패시키는 것: `remember` 의 축출 loop 를 지우는 것(크기가 상한을 넘는다), 또는
   *  `cachedThumbUrl` 이 맞힌 항목을 뒤로 옮기지 않는 것(방금 쓴 항목이 쫓겨난다). */
  test("holds at most MAX_RESOLVED_THUMBS, evicting the least recently used", async () => {
    await resolveThumbUrl("/v/0.jpg", 320);
    for (let i = 1; i < MAX_RESOLVED_THUMBS; i++) {
      await resolveThumbUrl(`/v/${i}.jpg`, 320);
    }
    expect(_thumbCacheSizes().resolved).toBe(MAX_RESOLVED_THUMBS);
    // Touch the oldest, then add two more: the next two oldest go, the touched one stays.
    expect(cachedThumbUrl("/v/0.jpg", 320)).not.toBeNull();
    await resolveThumbUrl("/v/new-a.jpg", 320);
    await resolveThumbUrl("/v/new-b.jpg", 320);

    expect(_thumbCacheSizes().resolved).toBe(MAX_RESOLVED_THUMBS);
    expect(cachedThumbUrl("/v/0.jpg", 320)).not.toBeNull();
    expect(cachedThumbUrl("/v/1.jpg", 320)).toBeNull();
    expect(cachedThumbUrl("/v/2.jpg", 320)).toBeNull();
    expect(cachedThumbUrl("/v/3.jpg", 320)).not.toBeNull();
  });

  /** 이것을 실패시키는 것: 실패 기록을 자르지 않는 것. */
  test("keeps at most MAX_THUMB_FAILURES failures", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    photoThumbnail.mockRejectedValue(new Error("unsupported"));
    for (let i = 0; i < MAX_THUMB_FAILURES + 50; i++) {
      await resolveThumbUrl(`/v/bad-${i}.svg`, 320);
    }
    expect(_thumbCacheSizes().failures).toBe(MAX_THUMB_FAILURES);
  });
});
