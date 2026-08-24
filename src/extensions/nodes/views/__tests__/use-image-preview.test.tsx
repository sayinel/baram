// §3.3 본문 이미지가 **원본을 <img>에 걸지 않는다**는 것을 지키는 테스트.
//
// 실앱에서 확인된 증상: 16320x12240(199.8 MPix) 사진에 마우스를 여러 번 왕복하면 이미지가
// 잠깐 배경색으로 번쩍인다(비트맵이 버려진 뒤 매 hover마다 재디코드). 같은 문서의
// 297x413 스크린샷은 그렇지 않다. 그래서 확인하는 것은 "프리뷰가 결국 뜬다"가 아니라
// "그 전에 원본이 걸린 적이 없다"다.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const photoThumbnail = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));
vi.mock("../../../../ipc/thumbnail", () => ({
  photoThumbnail: (path: string, maxPx: number) =>
    photoThumbnail(path, maxPx) as Promise<string>,
}));

const { useImagePreview } = await import("../use-image-preview");
const { _resetThumbCache, PREVIEW_MAX_PX } =
  await import("../../../../utils/journal/photo-thumbnail");
const { useEditorStore } = await import("../../../../stores/editor/editor");

const TAB = {
  contextId: "",
  filePath: "/vault/journal/daily/2025/08/2025-08-16.md",
  id: "tab-1",
  isDirty: false,
  isPinned: false,
  title: "2025-08-16.md",
};

describe("useImagePreview", () => {
  beforeEach(() => {
    _resetThumbCache();
    photoThumbnail.mockReset();
    photoThumbnail.mockResolvedValue("/cache/thumbnails/preview.jpg");
    useEditorStore.setState({ activeTabId: TAB.id, tabs: [TAB] });
  });

  test("asks for a preview at the shared size, resolved against the file's directory", async () => {
    renderHook(() => useImagePreview("assets/20250816-152728.jpg"));

    await waitFor(() => expect(photoThumbnail).toHaveBeenCalled());
    expect(photoThumbnail).toHaveBeenCalledWith(
      "/vault/journal/daily/2025/08/assets/20250816-152728.jpg",
      PREVIEW_MAX_PX,
    );
  });

  test("gives null — never the original — until the preview is ready", async () => {
    const { result } = renderHook(() =>
      useImagePreview("assets/20250816-152728.jpg"),
    );

    expect(result.current).toBeNull();

    await waitFor(() =>
      expect(result.current).toBe(
        "asset://localhost//cache/thumbnails/preview.jpg",
      ),
    );
  });

  test("falls back to the original when the backend cannot decode it", async () => {
    photoThumbnail.mockRejectedValue("썸네일을 만들 수 없는 이미지입니다");
    const { result } = renderHook(() => useImagePreview("assets/diagram.svg"));

    await waitFor(() =>
      expect(result.current).toBe(
        "asset://localhost//vault/journal/daily/2025/08/assets/diagram.svg",
      ),
    );
  });

  test("passes a remote URL or data URI straight through, with no IPC and no wait", () => {
    const remote = renderHook(() =>
      useImagePreview("https://example.com/a.png"),
    );
    expect(remote.result.current).toBe("https://example.com/a.png");

    const data = renderHook(() =>
      useImagePreview("data:image/png;base64,AAAA"),
    );
    expect(data.result.current).toBe("data:image/png;base64,AAAA");

    expect(photoThumbnail).not.toHaveBeenCalled();
  });

  test("an absolute path needs no active tab", async () => {
    useEditorStore.setState({ activeTabId: null, tabs: [] });

    renderHook(() => useImagePreview("/elsewhere/photo.jpg"));

    await waitFor(() =>
      expect(photoThumbnail).toHaveBeenCalledWith(
        "/elsewhere/photo.jpg",
        PREVIEW_MAX_PX,
      ),
    );
  });

  test("shares its cache entry with the lightbox — the same photo is built once", async () => {
    const { result: editor } = renderHook(() =>
      useImagePreview("assets/20250816-152728.jpg"),
    );
    await waitFor(() => expect(editor.current).not.toBeNull());

    // 갤러리 라이트박스가 같은 크기를 요구하므로 두 번째 요청은 IPC를 타지 않는다.
    const { usePhotoPreview } =
      await import("../../../../components/journal/use-photo-thumb");
    const { result: lightbox } = renderHook(() =>
      usePhotoPreview(
        "/vault/journal/daily/2025/08/assets/20250816-152728.jpg",
      ),
    );

    expect(lightbox.current?.url).toBe(
      "asset://localhost//cache/thumbnails/preview.jpg",
    );
    expect(photoThumbnail).toHaveBeenCalledTimes(1);
  });
});
