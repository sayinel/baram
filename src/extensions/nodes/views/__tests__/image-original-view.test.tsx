// §3.3 "원본 보기" — 본문이 프리뷰를 그리게 된 뒤 원본에 닿는 유일한 통로.
//
// 지키는 것 둘: 원본 URL은 **프리뷰 캐시가 아니라 원본 파일**을 가리켜야 하고(그렇지 않으면
// 기능이 이름만 남는다), 원본이 디코드되는 동안 모달이 비어 있지 않아야 한다(199.8 MPix는
// 초 단위가 걸린다).
//
// §397 원본의 경로가 있으면 `image_tiles` 에 묻는다 — Rust 를 부르는 `imageTiles` 를 목으로 바꾸고 크기 ·
// 답을 시험이 손으로 푼다. `tileUrl` 은 진짜다. `originalPath={null}` 인 시험은 오늘의 경로(spec 0078 D7)를 지킨다.
import type {
  TileSet,
  TileSetTiles,
  TileSize,
} from "../../../../ipc/image-tiles";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));
vi.mock("../../../../ipc/thumbnail", () => ({
  photoThumbnail: vi.fn(),
}));
vi.mock("../../../../ipc/image-tiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../ipc/image-tiles")>()),
  imageTiles: vi.fn(),
}));

const { ImageOriginalView } =
  await import("../../../../components/editor/ImageOriginalView");
const { imageTiles } = await import("../../../../ipc/image-tiles");
const { originalImagePath, originalImageUrl } =
  await import("../use-image-preview");
const { useEditorStore } = await import("../../../../stores/editor/editor");
const { zoomIn } = await import("../../../../hooks/use-zoom");
const { useSettingsStore } = await import("../../../../stores/settings/store");
const { topZoomOwner } = await import("../../../../utils/viewer-zoom");
const { t } = await import("../../../../i18n");

/** `imageTiles` 한 번의 부름 — 크기 · 답을 시험이 푼다. */
interface Call {
  onSize: (size: TileSize) => void;
  path: string;
  reject: (reason: unknown) => void;
  resolve: (set: TileSet) => void;
}

const ORIGINAL = "asset://localhost//vault/2025/08/assets/20250816-152728.jpg";
const PREVIEW = "asset://localhost//cache/thumbnails/preview.jpg";
const PATH = "/vault/2025/08/assets/20250816-152728.jpg";
/** 시험 사진 16320x12240 — 레벨 6 개(spec 0078 §5.1). */
const SET: TileSetTiles = {
  bytes: 34_000_000,
  dir: "/cache/v2/tiles/t1/abc",
  ext: "jpg",
  height: 12240,
  kind: "tiles",
  levels: [
    { h: 12240, w: 16320 },
    { h: 6120, w: 8160 },
    { h: 3060, w: 4080 },
    { h: 1530, w: 2040 },
    { h: 765, w: 1020 },
    { h: 383, w: 510 },
  ],
  tile: 512,
  width: 16320,
};
/** 가장 작은 레벨(5)의 한 장 — 프리뷰가 없을 때의 바닥 요소. */
const SMALLEST_TILE = "asset://localhost//cache/v2/tiles/t1/abc/5/0_0.jpg";

let calls: Call[] = [];

beforeEach(() => {
  calls = [];
  vi.mocked(imageTiles).mockReset();
  vi.mocked(imageTiles).mockImplementation(
    (path, onSize) =>
      new Promise<TileSet>((resolve, reject) => {
        calls.push({ onSize, path, reject, resolve });
      }),
  );
});

/** 상대 경로의 기준 — 2025-08-16 저널 노트가 열린 탭. */
function openJournalNote(): void {
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
}

describe("originalImageUrl", () => {
  beforeEach(openJournalNote);

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

// §397 타일을 물을 원본의 경로 — 프리뷰가 상대 경로를 푸는 규칙 그대로. 경로가 없으면 오늘의 원본 <img> 다.
describe("originalImagePath", () => {
  beforeEach(openJournalNote);

  test("resolves a relative src against the open note's folder and keeps an absolute one", () => {
    expect(originalImagePath("assets/20250816-152728.jpg")).toBe(PATH);
    expect(originalImagePath("/abs/x.jpg")).toBe("/abs/x.jpg");
  });

  test("has no path for a remote URL, a data URI or an empty src", () => {
    expect(originalImagePath("https://example.com/a.png")).toBeNull();
    expect(originalImagePath("data:image/png;base64,AAAA")).toBeNull();
    expect(originalImagePath("")).toBeNull();
  });

  test("has no path for a relative src when no note is open", () => {
    useEditorStore.setState({ activeTabId: null, tabs: [] });
    expect(originalImagePath("assets/20250816-152728.jpg")).toBeNull();
  });
});

describe("ImageOriginalView", () => {
  test("shows the preview first, then swaps to the original once it loads", async () => {
    render(
      <ImageOriginalView
        alt="바다"
        onClose={vi.fn()}
        originalPath={null}
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
        originalPath={null}
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
        originalPath={null}
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

// §397 경로가 있는 원본 보기. jsdom 에는 레이아웃이 없어서 사각형을 목으로 준다 — 본문(스크롤 영역)은
// 1200x900, 바닥 요소는 그 가운데 800x600(dpr 1 에서 레벨 4 = 1020x765, 타일 2x2). `brokenSrc` 인 바닥
// 요소에는 상자가 없다.
describe("ImageOriginalView with tiles", () => {
  let brokenSrc: null | string = null;

  beforeEach(() => {
    brokenSrc = null;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.classList.contains("image-view-fullscreen-body")) {
          return new DOMRect(0, 0, 1200, 900);
        }
        if (
          this.classList.contains("image-fullscreen-img") &&
          this.getAttribute("src") !== brokenSrc
        ) {
          return new DOMRect(200, 150, 800, 600);
        }
        return new DOMRect(0, 0, 0, 0);
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderTiled(previewUrl: null | string = PREVIEW) {
    return render(
      <ImageOriginalView
        alt="바다"
        onClose={vi.fn()}
        originalPath={PATH}
        originalUrl={ORIGINAL}
        previewUrl={previewUrl}
      />,
    );
  }

  const base = () =>
    document.body.querySelector<HTMLImageElement>(".image-fullscreen-img");
  const header = () =>
    document.body.querySelector(".image-fullscreen-label")?.textContent;
  const sources = () =>
    Array.from(document.body.querySelectorAll("img")).map((img) =>
      img.getAttribute("src"),
    );
  const tileImgs = () =>
    Array.from(
      document.body.querySelectorAll<HTMLImageElement>(".image-tile-layer img"),
    );

  /** 오늘의 경로 — `ImageOriginalView` 의 첫 시험과 같은 흐름이다. */
  async function expectTodaysPath() {
    const placeholder = screen.getByRole("img", { name: "바다" });
    expect(placeholder.getAttribute("src")).toBe(PREVIEW);
    expect(placeholder.className.split(" ")).toContain(
      "image-fullscreen-img-preview",
    );
    expect(screen.getByText("Loading original…")).toBeTruthy();
    const original = screen
      .getAllByRole("img", { hidden: true })
      .find((el) => el.getAttribute("src") === ORIGINAL)!;
    expect(original).toBeTruthy();
    expect(tileImgs()).toHaveLength(0);

    fireEvent.load(original);

    await waitFor(() => expect(screen.getByText("Original")).toBeTruthy());
    const shown = screen.getByRole("img", { name: "바다" });
    expect(shown.getAttribute("src")).toBe(ORIGINAL);
    expect(shown.className.split(" ")).not.toContain(
      "image-fullscreen-img-preview",
    );
  }

  test("with a path, the original <img> is never mounted while tiles are pending or shown", async () => {
    renderTiled();
    expect(calls.map((c) => c.path)).toEqual([PATH]);
    // 바닥 요소(프리뷰)는 있고 원본은 없다
    expect(sources()).toEqual([PREVIEW]);

    act(() => calls[0].onSize({ height: 12240, width: 16320 }));
    expect(sources()).toEqual([PREVIEW]);

    await act(async () => calls[0].resolve(SET));
    expect(tileImgs()).toHaveLength(4);
    expect(sources()).toContain(PREVIEW);
    expect(sources()).not.toContain(ORIGINAL);

    for (const img of tileImgs()) fireEvent.load(img);
    expect(header()).toBe("Original");
    expect(sources()).not.toContain(ORIGINAL);
  });

  test("the size arrives first and the preview takes the original's width and height", async () => {
    renderTiled();
    const shown = base()!;
    expect(shown.getAttribute("src")).toBe(PREVIEW);
    expect(shown.hasAttribute("width")).toBe(false);

    act(() => calls[0].onSize({ height: 12240, width: 16320 }));
    expect([shown.getAttribute("width"), shown.getAttribute("height")]).toEqual(
      ["16320", "12240"],
    );
    expect(shown.className.split(" ")).toContain(
      "image-fullscreen-img-preview",
    );

    // 타일 레이어는 바닥 요소를 피라미드마다 한 번 읽는다 — 답이 와도 같은 요소여야 한다
    await act(async () => calls[0].resolve(SET));
    expect(base()).toBe(shown);
    expect(tileImgs()).toHaveLength(4);
  });

  test("the header says loading until the tile layer is ready, then Original", async () => {
    renderTiled();
    expect(header()).toBe("Loading original…");

    // 캐시 히트 — 크기 없이 바로 답이 오고, 크기는 피라미드에서 온다
    await act(async () => calls[0].resolve(SET));
    expect([
      base()!.getAttribute("width"),
      base()!.getAttribute("height"),
    ]).toEqual(["16320", "12240"]);
    const tiles = tileImgs();
    expect(tiles).toHaveLength(4);
    for (const img of tiles.slice(0, -1)) fireEvent.load(img);
    expect(header()).toBe("Loading original…");
    expect(base()!.className.split(" ")).toContain(
      "image-fullscreen-img-preview",
    );

    fireEvent.load(tiles[tiles.length - 1]);
    expect(header()).toBe("Original");
    expect(base()!.className.split(" ")).toEqual(["image-fullscreen-img"]);
  });

  test("another photo opened in the same viewer waits for its own tiles", async () => {
    const view = renderTiled();
    await act(async () => calls[0].resolve(SET));
    for (const img of tileImgs()) fireEvent.load(img);
    expect(header()).toBe("Original");

    const other = "/vault/2025/08/assets/20250817-090000.jpg";
    view.rerender(
      <ImageOriginalView
        alt="바다"
        onClose={vi.fn()}
        originalPath={other}
        originalUrl={ORIGINAL}
        previewUrl={PREVIEW}
      />,
    );
    expect(calls.map((c) => c.path)).toEqual([PATH, other]);
    expect(header()).toBe("Loading original…");

    await act(async () =>
      calls[1].resolve({ ...SET, dir: "/cache/v2/tiles/t1/def" }),
    );
    const tiles = tileImgs();
    expect(tiles.map((img) => img.getAttribute("src"))).toContain(
      "asset://localhost//cache/v2/tiles/t1/def/4/0_0.jpg",
    );
    expect(header()).toBe("Loading original…");
    for (const img of tiles) fireEvent.load(img);
    expect(header()).toBe("Original");
  });

  test("with no preview, the smallest tile becomes the base when the tiles arrive", async () => {
    renderTiled(null);
    expect(sources()).toEqual([]);

    await act(async () => calls[0].resolve(SET));
    expect(base()!.getAttribute("src")).toBe(SMALLEST_TILE);
    expect(base()!.getAttribute("alt")).toBe("바다");
    expect(tileImgs()).toHaveLength(4);
  });

  // 썸네일을 만들지 못하면 프리뷰 자리에 원본이 온다(`resolveThumbUrl` 의 폴백) — 두 opener 모두 원본 URL 과 같은
  // 글자다. 큰 사진임을 알면(크기나 피라미드가 오면) 그것을 프리뷰로 치지 않는다: 바닥 요소가 원본이면 피라미드를
  // 짓는 동안 그 원본을 디코드하고(spec 0078 D6), 다 된 뒤에도 줌마다 원본을 다시 그린다.
  test("a preview that is the original itself is dropped once the photo is known to be big", async () => {
    renderTiled(ORIGINAL);
    // 크기를 모를 때는 그대로 둔다 — 두 변이 2048 이하인 사진의 프리뷰는 원래 원본이다
    expect(sources()).toEqual([ORIGINAL]);

    act(() => calls[0].onSize({ height: 12240, width: 16320 }));
    expect(sources()).toEqual([]);

    await act(async () => calls[0].resolve(SET));
    expect(base()!.getAttribute("src")).toBe(SMALLEST_TILE);
    expect(tileImgs()).toHaveLength(4);
    expect(sources()).not.toContain(ORIGINAL);
    for (const img of tileImgs()) fireEvent.load(img);
    expect(header()).toBe("Original");
    expect(sources()).not.toContain(ORIGINAL);
  });

  test("on a cache hit, a preview that is the original gives way to the smallest tile on the same element", async () => {
    renderTiled(ORIGINAL);
    const shown = base()!;
    expect(shown.getAttribute("src")).toBe(ORIGINAL);

    await act(async () => calls[0].resolve(SET));
    expect(base()).toBe(shown);
    expect(shown.getAttribute("src")).toBe(SMALLEST_TILE);
    expect(sources()).not.toContain(ORIGINAL);
  });

  test("an original answer keeps a preview that is the original, as before", async () => {
    renderTiled(ORIGINAL);
    await act(async () => calls[0].resolve({ kind: "original" }));
    // 오늘의 경로 그대로 — 흐린 프리뷰(원본 URL)와 숨긴 원본 <img>
    const imgs = screen.getAllByRole("img", { hidden: true });
    expect(imgs.map((img) => [img.getAttribute("src"), img.className])).toEqual(
      [
        [ORIGINAL, "image-fullscreen-img image-fullscreen-img-preview"],
        [ORIGINAL, "image-fullscreen-img"],
      ],
    );
    fireEvent.load(imgs[1]);
    expect(header()).toBe("Original");
    expect(sources()).toEqual([ORIGINAL]);
  });

  test("falls back to the original <img> when image_tiles rejects", async () => {
    renderTiled();
    // 크기를 알린 뒤 생성이 실패한다(디코드 실패 · 쓰기 실패) — spec 0078 §3 실패 조건 · D7
    act(() => calls[0].onSize({ height: 12240, width: 16320 }));
    await act(async () => calls[0].reject("§397 tiles FAILED"));
    await expectTodaysPath();
  });

  test("falls back to the original <img> when image_tiles answers original", async () => {
    renderTiled();
    await act(async () => calls[0].resolve({ kind: "original" }));
    await expectTodaysPath();
  });

  // 상자가 없는 바닥 요소는 배치가 비어 첫 레이어가 끝나지 않는다 — 실패한 프리뷰를 두면 헤더가 "원본 불러오는 중…"
  // 에 남는다. 그래서 같은 요소의 src 를 가장 작은 타일로 바꾼다(spec 0078 D5 의 프리뷰가 없을 때의 바닥 요소).
  test("a preview that fails to load gives way to the smallest tile on the same element", async () => {
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        disconnect() {}
        observe() {}
        unobserve() {}
      },
    );
    brokenSrc = PREVIEW;
    renderTiled();
    await act(async () => calls[0].resolve(SET));
    const shown = base()!;
    expect(tileImgs()).toHaveLength(0);

    fireEvent.error(shown);
    expect(base()).toBe(shown);
    expect(shown.getAttribute("src")).toBe(SMALLEST_TILE);
    // 그 타일마저 실패해도 한 번뿐이다 — 더 작은 것이 없다
    fireEvent.error(shown);
    expect(shown.getAttribute("src")).toBe(SMALLEST_TILE);

    // 바닥 요소가 상자를 얻었다 — 관찰 콜백이 다시 배치한다
    act(() => {
      for (const callback of observers) callback();
    });
    const tiles = tileImgs();
    expect(tiles).toHaveLength(4);
    expect(header()).toBe("Loading original…");
    for (const img of tiles) fireEvent.load(img);
    expect(header()).toBe("Original");
  });
});

// §396 — the original view is a zoom owner; jsdom has no layout, so the rect is mocked per element:
// the blurred preview fits at 400 x 300, the original at 800 x 600.
describe("ImageOriginalView zoom", () => {
  const realLocale = useSettingsStore.getState().locale;

  beforeEach(() => {
    useSettingsStore.setState({ zoomLevel: 1 });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (!this.classList.contains("image-fullscreen-img")) {
          return new DOMRect(0, 0, 0, 0);
        }
        return this.classList.contains("image-fullscreen-img-preview")
          ? new DOMRect(0, 0, 400, 300)
          : new DOMRect(0, 0, 800, 600);
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useSettingsStore.setState({ locale: realLocale });
  });

  function renderView() {
    return render(
      <ImageOriginalView
        alt="바다"
        onClose={vi.fn()}
        originalPath={null}
        originalUrl={ORIGINAL}
        previewUrl={PREVIEW}
      />,
    );
  }

  const body = () =>
    document.body.querySelector<HTMLElement>(".image-view-fullscreen-body")!;

  test("is the zoom owner; zoomIn() scales the image, not the editor", () => {
    expect(topZoomOwner()).toBeNull();
    renderView();
    expect(topZoomOwner()).not.toBeNull();
    expect(screen.getByText("100%")).toBeTruthy();
    expect(body().hasAttribute("data-viewer-zoomed")).toBe(false);
    act(() => zoomIn());
    expect(screen.getByText("125%")).toBeTruthy();
    expect(body().hasAttribute("data-viewer-zoomed")).toBe(true);
    expect(useSettingsStore.getState().zoomLevel).toBe(1);
  });

  test("re-measures when the original replaces the preview", () => {
    renderView();
    act(() => zoomIn());
    // Measured on the preview, because the hidden original has no width.
    expect(body().style.getPropertyValue("--viewer-zoom-width")).toBe("500px");
    const original = screen
      .getAllByRole("img", { hidden: true })
      .find((el) => el.getAttribute("src") === ORIGINAL)!;
    fireEvent.load(original);
    expect(body().style.getPropertyValue("--viewer-zoom-width")).toBe("1000px");
    expect(body().style.getPropertyValue("--viewer-zoom-height")).toBe("750px");
    expect(screen.getByText("125%")).toBeTruthy();
  });

  // §397 — the blurred base fits at 400 x 300 in this mock, so the layer lays out the single tile of
  // level 5; once it loads the base drops the preview class and fits at 800 x 600.
  test("zoom re-measures when the tiles become ready", async () => {
    render(
      <ImageOriginalView
        alt="바다"
        onClose={vi.fn()}
        originalPath={PATH}
        originalUrl={ORIGINAL}
        previewUrl={PREVIEW}
      />,
    );
    await act(async () => calls[0].resolve(SET));
    act(() => zoomIn());
    expect(body().style.getPropertyValue("--viewer-zoom-width")).toBe("500px");

    const tiles = Array.from(
      document.body.querySelectorAll<HTMLImageElement>(".image-tile-layer img"),
    );
    expect(tiles).toHaveLength(1);
    fireEvent.load(tiles[0]);
    expect(body().style.getPropertyValue("--viewer-zoom-width")).toBe("1000px");
    expect(body().style.getPropertyValue("--viewer-zoom-height")).toBe("750px");
    expect(screen.getByText("125%")).toBeTruthy();
  });

  test("unmount leaves editor zoom untouched", () => {
    const view = renderView();
    act(() => zoomIn());
    view.unmount();
    expect(topZoomOwner()).toBeNull();
    expect(useSettingsStore.getState().zoomLevel).toBe(1);
    act(() => zoomIn());
    expect(useSettingsStore.getState().zoomLevel).not.toBe(1);
  });

  test("header labels come from the catalog", () => {
    useSettingsStore.setState({ locale: "ko" });
    renderView();
    expect(t("imageOriginal.loading", "ko")).not.toBe("imageOriginal.loading");
    expect(screen.getByText(t("imageOriginal.loading", "ko"))).toBeTruthy();
    expect(screen.getByText(t("common.close", "ko"))).toBeTruthy();
    expect(screen.queryByText("Loading original…")).toBeNull();
    const original = screen
      .getAllByRole("img", { hidden: true })
      .find((el) => el.getAttribute("src") === ORIGINAL)!;
    fireEvent.load(original);
    expect(screen.getByText(t("imageOriginal.title", "ko"))).toBeTruthy();
    expect(screen.queryByText("Original")).toBeNull();
  });
});
