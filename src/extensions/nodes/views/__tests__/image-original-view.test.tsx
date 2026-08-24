// §3.3 "원본 보기" — 본문이 프리뷰를 그리게 된 뒤 원본에 닿는 유일한 통로.
//
// 지키는 것 둘: 원본 URL은 **프리뷰 캐시가 아니라 원본 파일**을 가리켜야 하고(그렇지 않으면
// 기능이 이름만 남는다), 원본이 디코드되는 동안 모달이 비어 있지 않아야 한다(199.8 MPix는
// 초 단위가 걸린다).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));
vi.mock("../../../../ipc/thumbnail", () => ({
  photoThumbnail: vi.fn(),
}));

const { ImageOriginalView } =
  await import("../../../../components/editor/ImageOriginalView");
const { originalImageUrl } = await import("../use-image-preview");
const { useEditorStore } = await import("../../../../stores/editor/editor");

const ORIGINAL = "asset://localhost//vault/2025/08/assets/20250816-152728.jpg";
const PREVIEW = "asset://localhost//cache/thumbnails/preview.jpg";

describe("originalImageUrl", () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [
        {
          contextId: "",
          filePath: "/vault/2025/08/2025-08-16.md",
          id: "t1",
          isDirty: false,
          isPinned: false,
          title: "2025-08-16.md",
        },
      ],
    });
  });

  test("points at the original file, never at a cached preview", () => {
    expect(originalImageUrl("assets/20250816-152728.jpg")).toBe(ORIGINAL);
  });

  test("leaves a remote URL and a data URI alone", () => {
    expect(originalImageUrl("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
    expect(originalImageUrl("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
  });
});

describe("ImageOriginalView", () => {
  test("shows the preview first, then swaps to the original once it loads", async () => {
    render(
      <ImageOriginalView
        alt="바다"
        onClose={vi.fn()}
        originalUrl={ORIGINAL}
        previewUrl={PREVIEW}
      />,
    );

    // 원본이 아직 안 떴을 때: 흐린 프리뷰가 보이고, 헤더가 기다리는 중임을 말한다.
    const placeholder = screen.getByRole("img", { name: "바다" });
    expect(placeholder.getAttribute("src")).toBe(PREVIEW);
    expect(placeholder.className.split(" ")).toContain(
      "image-fullscreen-img-preview",
    );
    expect(screen.getByText("Loading original…")).toBeTruthy();

    // 원본 <img>는 이미 DOM에 있지만 숨어 있다 — src를 갈아끼우지 않으므로 교체 시
    // 빈 프레임이 없다.
    const original = screen
      .getAllByRole("img", { hidden: true })
      .find((el) => el.getAttribute("src") === ORIGINAL)!;
    expect(original).toBeTruthy();

    fireEvent.load(original);

    await waitFor(() => expect(screen.getByText("Original")).toBeTruthy());
    const shown = screen.getByRole("img", { name: "바다" });
    expect(shown.getAttribute("src")).toBe(ORIGINAL);
    expect(shown.className.split(" ")).not.toContain(
      "image-fullscreen-img-preview",
    );
  });

  test("renders the original alone when no preview is cached yet", () => {
    render(
      <ImageOriginalView
        alt="바다"
        onClose={vi.fn()}
        originalUrl={ORIGINAL}
        previewUrl={null}
      />,
    );

    const imgs = screen.getAllByRole("img", { hidden: true });
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe(ORIGINAL);
  });

  test("closes on Escape and on the Close button", () => {
    const onClose = vi.fn();
    render(
      <ImageOriginalView
        alt="바다"
        onClose={onClose}
        originalUrl={ORIGINAL}
        previewUrl={PREVIEW}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
