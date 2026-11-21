// §397 원본 보기의 타일 레이어. jsdom 에는 레이아웃이 없어서 `getBoundingClientRect` 를 목으로 바꾼다 —
// 본문(스크롤 영역)은 `bodyRect`, 바닥 요소는 `baseRect`. 줌은 바닥 요소의 사각형을 바꾸고 ResizeObserver
// 콜백을 부르는 것으로 흉내 낸다(앱에서는 줌이 바닥 요소의 크기를 바꾸고 그 관찰이 불린다). 타일 `<img>` 는
// 스스로 로드되지 않으므로 `load` · `error` 를 시험이 쏜다.
//
// 사진은 16320x12240 — 레벨 6 개, 타일 768 · 192 · 48 · 12 · 4 · 1(spec 0078 §5.1). dpr 2, 본문 1200x900.
import type { RefObject } from "react";
import { Profiler, useRef } from "react";

import type { TileSetTiles } from "../../../../ipc/image-tiles";
import type { Rect } from "../../../../utils/image-tiles/tile-layout";

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

const { ImageTileLayer } =
  await import("../../../../components/editor/ImageTileLayer");
const { layoutTiles, layoutTilesAtLevel } =
  await import("../../../../utils/image-tiles/tile-layout");

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

let bodyRect: Rect = { height: 900, left: 0, top: 0, width: 1200 };
let baseRect: Rect = centered(1102);
let observers: { callback: () => void; targets: Element[] }[] = [];
let savedDpr: number;

/** 본문 가운데에 놓인 바닥 요소 — 그려진 가로 `width`, 세로는 사진 비율. */
function centered(width: number, body: Rect = bodyRect): Rect {
  const height = (width * SET.height) / SET.width;
  return {
    height,
    left: body.left + (body.width - width) / 2,
    top: body.top + (body.height - height) / 2,
    width,
  };
}

function domRect({ height, left, top, width }: Rect): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  };
}

function Harness({
  onReady,
  set = SET,
}: {
  onReady: () => void;
  set?: TileSetTiles;
}) {
  const baseRef = useRef<HTMLImageElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <div className="body" ref={bodyRef}>
      <img alt="" className="base" ref={baseRef} />
      <ImageTileLayer
        baseRef={baseRef}
        bodyRef={bodyRef as RefObject<HTMLElement | null>}
        onReady={onReady}
        set={set}
      />
    </div>
  );
}

function levelDivs(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      ".image-tile-layer > [data-tile-level]",
    ),
  ).map((el) => el.dataset.tileLevel ?? "");
}

function loadAll(level: number): void {
  for (const img of tiles(level)) fireEvent.load(img);
}

/** 바닥 요소의 사각형을 바꾸고 관찰 콜백을 부른다 — 줌 · 창 크기 변화. */
function relayout(next: Rect): void {
  baseRect = next;
  act(() => {
    for (const o of observers) o.callback();
  });
}

/** 타일의 `${level}/${col}_${row}` — src 의 끝에서 읽는다. */
function tileKey(img: HTMLImageElement): string {
  const match = /\/(\d+)\/(\d+_\d+)\.jpg$/.exec(img.getAttribute("src") ?? "");
  return match ? `${match[1]}/${match[2]}` : "";
}

function tiles(level: number): HTMLImageElement[] {
  return Array.from(
    document.querySelectorAll<HTMLImageElement>(
      `.image-tile-layer > [data-tile-level="${level}"] img`,
    ),
  );
}

beforeEach(() => {
  bodyRect = { height: 900, left: 0, top: 0, width: 1200 };
  baseRect = centered(1102);
  observers = [];
  savedDpr = window.devicePixelRatio;
  window.devicePixelRatio = 2;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.classList.contains("body")) return domRect(bodyRect);
      if (this.classList.contains("base")) return domRect(baseRect);
      return domRect({ height: 0, left: 0, top: 0, width: 0 });
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      targets: Element[] = [];
      constructor(callback: () => void) {
        observers.push({ callback, targets: this.targets });
      }
      disconnect() {
        this.targets.length = 0;
      }
      observe(el: Element) {
        this.targets.push(el);
      }
      unobserve() {}
    },
  );
});

afterEach(() => {
  cleanup();
  window.devicePixelRatio = savedDpr;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ImageTileLayer", () => {
  test("mounts the 48 tiles of level 2 for a 1102px-wide base at dpr 2", () => {
    render(<Harness onReady={vi.fn()} />);

    const root = document.querySelector<HTMLElement>(".image-tile-layer")!;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    // 바닥 요소의 자리(49, 36.75)를 기기 픽셀(dpr 2 → 0.5px)에 맞춘 것
    expect([root.style.left, root.style.top]).toEqual(["49px", "37px"]);
    expect(levelDivs()).toEqual(["2"]);
    const imgs = tiles(2);
    expect(imgs).toHaveLength(48);
    const first = imgs[0];
    expect(first.getAttribute("alt")).toBe("");
    expect(first.getAttribute("decoding")).toBe("async");
    expect(first.getAttribute("draggable")).toBe("false");
    expect(first.getAttribute("src")).toBe(
      "asset://localhost//cache/v2/tiles/t1/abc/2/0_0.jpg",
    );

    // 각 타일의 위치 · 크기는 배치 함수의 값 그대로다(바닥 요소 기준 CSS px)
    const expected = layoutTiles(SET, baseRect, bodyRect, 2).tiles;
    expect(
      imgs.map((img) => [
        tileKey(img),
        img.style.left,
        img.style.top,
        img.style.width,
        img.style.height,
      ]),
    ).toEqual(
      expected.map((t) => [
        t.key,
        `${t.x}px`,
        `${t.y}px`,
        `${t.w}px`,
        `${t.h}px`,
      ]),
    );
  });

  test("puts the root on the device pixel nearest the base, and scrolling does not move it", () => {
    // `offsetLeft` · `offsetTop` 은 정수로 반올림된다 — 100.3 이면 100 이고, dpr 2 에서 기기 픽셀 하나만큼
    // 그려진 바닥 요소에서 어긋난다. 루트는 사각형에서 잰 자리를 기기 픽셀에 맞춘다.
    baseRect = { ...centered(1102), left: 100.3, top: 50.2 };
    const commits = vi.fn();
    render(
      <Profiler id="layer" onRender={commits}>
        <Harness onReady={vi.fn()} />
      </Profiler>,
    );
    const root = document.querySelector<HTMLElement>(".image-tile-layer")!;
    expect([root.style.left, root.style.top]).toEqual(["100.5px", "50px"]);

    // 본문이 스크롤되면 바닥 요소의 사각형이 그만큼 움직인다 — 루트의 자리는 그대로고 커밋도 없다
    const body = document.querySelector<HTMLElement>(".body")!;
    const committed = commits.mock.calls.length;
    body.scrollLeft = 300;
    body.scrollTop = 120;
    baseRect = { ...baseRect, left: 100.3 - 300, top: 50.2 - 120 };
    fireEvent.scroll(body);
    expect([root.style.left, root.style.top]).toEqual(["100.5px", "50px"]);
    expect(commits.mock.calls.length).toBe(committed);
  });

  test("calls onReady once, only after every first-layer tile has loaded", () => {
    const onReady = vi.fn();
    render(<Harness onReady={onReady} />);
    const imgs = tiles(2);
    for (const img of imgs.slice(0, -1)) fireEvent.load(img);
    expect(onReady).not.toHaveBeenCalled();

    fireEvent.load(imgs[imgs.length - 1]);
    expect(onReady).toHaveBeenCalledTimes(1);

    // 다시 배치하고 다른 레벨이 끝나도, 같은 타일이 또 load 해도 다시 부르지 않는다
    fireEvent.load(imgs[0]);
    relayout(centered(4408));
    loadAll(0);
    expect(levelDivs()).toEqual(["0"]);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  test("a tile that fails to load counts as settled: onReady still fires and nothing throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReady = vi.fn();
    render(<Harness onReady={onReady} />);
    const imgs = tiles(2);
    fireEvent.error(imgs[0]);
    fireEvent.error(imgs[1]);
    for (const img of imgs.slice(2)) fireEvent.load(img);
    expect(onReady).toHaveBeenCalledTimes(1);
    // 로그는 레이어의 수명에 한 번
    expect(warn).toHaveBeenCalledTimes(1);

    // 실패한 타일이 있는 레벨도 다 끝난 레벨이라 다음 레벨의 밑에 남고, 새 레벨이 끝나면 떠난다
    relayout(centered(4408));
    expect(levelDivs()).toEqual(["2", "0"]);
    loadAll(0);
    expect(levelDivs()).toEqual(["0"]);
  });

  test("keeps the last settled level under the new one until every new tile settles", () => {
    render(<Harness onReady={vi.fn()} />);
    loadAll(2);
    const center = tiles(2).find((img) => tileKey(img) === "2/3_2")!;

    relayout(centered(4408));
    // 밑 레이어가 DOM 에서 먼저 — 나중 형제인 지금 레이어가 위에 그려진다
    expect(levelDivs()).toEqual(["2", "0"]);
    const under = tiles(2);
    expect(under.length).toBeGreaterThan(0);
    expect(under.length).toBeLessThan(48);
    // 밑에 남은 타일은 같은 `<img>` 다 — 다시 붙이면 다시 디코드한다. 위치는 지금 크기로 다시 잰 것
    expect(center.isConnected).toBe(true);
    expect(under).toContain(center);
    // 레벨 2 의 타일은 다 로드됐으니 밑 레이어는 레벨 2 를 지금 사각형에 배치한 것 전부다
    expect(
      under.map((img) => [tileKey(img), img.style.left, img.style.width]),
    ).toEqual(
      layoutTilesAtLevel(SET, 2, baseRect, bodyRect, 2).map((t) => [
        t.key,
        `${t.x}px`,
        `${t.w}px`,
      ]),
    );

    const fresh = tiles(0);
    for (const img of fresh.slice(0, -1)) fireEvent.load(img);
    expect(levelDivs()).toEqual(["2", "0"]);
    fireEvent.load(fresh[fresh.length - 1]);
    expect(levelDivs()).toEqual(["0"]);
  });

  test("two quick steps keep the last settled level, not the one in between", () => {
    render(<Harness onReady={vi.fn()} />);
    loadAll(2);

    relayout(centered(2204));
    expect(levelDivs()).toEqual(["2", "1"]);
    const between = tiles(1);
    for (const img of between.slice(0, 3)) fireEvent.load(img);

    relayout(centered(4408));
    expect(levelDivs()).toEqual(["2", "0"]);

    loadAll(0);
    expect(levelDivs()).toEqual(["0"]);
  });

  test("a zoom-out keeps only the tiles of the settled level that had loaded, never its whole grid", () => {
    // 800% 에서 맞춤으로 줄이면 레벨 0 을 맞춤 크기로 배치한 768 장이 다 보이는 범위에 든다.
    // 그것을 다 붙이면 200 MP 를 통째로 디코드한다 — 이 기능이 없애려던 멈춤이다.
    baseRect = centered(4408);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Harness onReady={vi.fn()} />);
    const first = tiles(0);
    expect(first.length).toBeLessThan(768);
    fireEvent.error(first[0]);
    for (const img of first.slice(1)) fireEvent.load(img);
    const loaded = new Set(first.slice(1).map(tileKey));
    expect(warn).toHaveBeenCalledTimes(1);

    relayout(centered(800));
    expect(levelDivs()).toEqual(["0", "3"]);
    const under = tiles(0).map(tileKey);
    expect(under.length).toBeGreaterThan(0);
    expect(under.length).toBeLessThanOrEqual(loaded.size);
    // 로드되지 않은(실패한) 타일도 밑에 다시 붙이지 않는다
    expect(under.every((key) => loaded.has(key))).toBe(true);
    expect(under).not.toContain(tileKey(first[0]));

    loadAll(3);
    expect(levelDivs()).toEqual(["3"]);
  });

  test("a zoom-out after a pan keeps only the tiles mounted just before it, as the same elements", () => {
    // 팬으로 배치를 떠난 타일의 `<img>` 는 떼어졌다 — 밑에 다시 붙이면 새 요소라 다시 받고 디코드한다
    baseRect = centered(4408);
    render(<Harness onReady={vi.fn()} />);
    loadAll(0);
    const before = new Set(tiles(0).map(tileKey));

    baseRect = { ...baseRect, left: baseRect.left - 1500 };
    fireEvent.scroll(document.querySelector(".body")!);
    expect(levelDivs()).toEqual(["0"]);
    loadAll(0);
    const mounted = tiles(0);
    // 팬이 실제로 로드된 타일을 배치 밖으로 보냈다
    expect([...before].some((key) => !mounted.map(tileKey).includes(key))).toBe(
      true,
    );

    relayout(centered(800));
    expect(levelDivs()).toEqual(["0", "3"]);
    const under = tiles(0);
    expect(under.length).toBeGreaterThan(0);
    expect(under.every((img) => mounted.includes(img))).toBe(true);
  });

  test("at a pending level, a tile that leaves and comes back must load again before the level settles", () => {
    render(<Harness onReady={vi.fn()} />);
    loadAll(2);
    relayout(centered(4408));
    expect(levelDivs()).toEqual(["2", "0"]);
    const body = document.querySelector(".body")!;
    // 17 열은 아래 팬 내내 배치에 남고, 10 열은 팬으로 떠났다가 돌아온다
    const held = "0/17_11";
    const leaver = "0/10_11";
    for (const img of tiles(0)) {
      if (tileKey(img) !== held) fireEvent.load(img);
    }
    const first = tiles(0).find((img) => tileKey(img) === leaver)!;

    const home = baseRect;
    baseRect = { ...home, left: home.left - 600 };
    fireEvent.scroll(body);
    expect(tiles(0).map(tileKey)).not.toContain(leaver);
    expect(tiles(0).map(tileKey)).toContain(held);
    baseRect = home;
    fireEvent.scroll(body);

    const back = tiles(0).find((img) => tileKey(img) === leaver)!;
    expect(back).not.toBe(first);
    for (const img of tiles(0)) {
      if (img !== back) fireEvent.load(img);
    }
    // 돌아온 타일은 새 요소이고 아직 로드되지 않았다 — 레벨 2 가 밑에 남는다
    expect(levelDivs()).toEqual(["2", "0"]);
    fireEvent.load(back);
    expect(levelDivs()).toEqual(["0"]);
  });

  // 아래 셋은 레벨을 바꾸는 배치 둘이 커밋 하나 사이에 든다 — 스크롤 · 크기 관찰은 React 가 커밋하기 전에 몇 번이든
  // 올 수 있다. 시험은 act 하나 안에서 관찰 콜백을 두 번 불러 커밋을 붙잡는다(act 를 나갈 때 한 번 커밋한다).
  // React 는 마지막 배치만 커밋하므로 돌아온 레벨의 요소는 그대로 남고, 이미 로드된 요소는 load 를 다시 쏘지 않는다.
  test("a first layer that flips to another level and back before one commit still settles", () => {
    const onReady = vi.fn();
    const commits = vi.fn();
    render(
      <Profiler id="layer" onRender={commits}>
        <Harness onReady={onReady} />
      </Profiler>,
    );
    const first = tiles(2);
    for (const img of first.slice(0, -1)) fireEvent.load(img);
    const committed = commits.mock.calls.length;

    act(() => {
      baseRect = centered(4408);
      for (const o of observers) o.callback();
      baseRect = centered(1102);
      for (const o of observers) o.callback();
    });
    // 두 배치에 커밋은 하나이고, 레벨 0 은 한 번도 붙지 않았다 — 레벨 2 의 요소는 같은 요소다
    expect(commits.mock.calls.length - committed).toBe(1);
    expect(levelDivs()).toEqual(["2"]);
    expect(tiles(2).filter((img, i) => img !== first[i])).toEqual([]);

    fireEvent.load(first[first.length - 1]);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  test("a pending level that returns after the settled level, before one commit, still settles", () => {
    render(<Harness onReady={vi.fn()} />);
    loadAll(2);
    relayout(centered(4408));
    expect(levelDivs()).toEqual(["2", "0"]);
    const pending = tiles(0);
    for (const img of pending.slice(0, -1)) fireEvent.load(img);

    act(() => {
      baseRect = centered(1102);
      for (const o of observers) o.callback();
      baseRect = centered(4408);
      for (const o of observers) o.callback();
    });
    expect(levelDivs()).toEqual(["2", "0"]);
    expect(tiles(0).filter((img, i) => img !== pending[i])).toEqual([]);

    fireEvent.load(pending[pending.length - 1]);
    expect(levelDivs()).toEqual(["0"]);
  });

  test("the old settled level returning right after a new level settles, before one commit, still settles", () => {
    render(<Harness onReady={vi.fn()} />);
    loadAll(2);
    relayout(centered(4408));
    // 밑 레이어로 남은 레벨 2 의 요소 — 로드된 채 붙어 있다
    const kept = tiles(2);
    expect(kept.length).toBeGreaterThan(0);
    const fresh = tiles(0);
    for (const img of fresh.slice(0, -1)) fireEvent.load(img);

    act(() => {
      // 레벨 0 이 다 끝나 지금 끝난 레벨이 되고, 같은 커밋 전에 레벨 2 로 돌아간다
      fireEvent.load(fresh[fresh.length - 1]);
      baseRect = centered(1102);
      for (const o of observers) o.callback();
    });
    expect(levelDivs()).toEqual(["0", "2"]);
    const back = tiles(2);
    expect(kept.every((img) => back.includes(img))).toBe(true);

    // 밑에 남았던 요소는 load 를 다시 쏘지 않는다 — 새로 붙은 것만 로드한다
    for (const img of back) {
      if (!kept.includes(img)) fireEvent.load(img);
    }
    expect(levelDivs()).toEqual(["2"]);
  });

  test("a body resize re-lays the tiles out", () => {
    render(<Harness onReady={vi.fn()} />);
    const body = document.querySelector(".body")!;
    const base = document.querySelector(".base")!;
    const watching = observers.filter((o) => o.targets.includes(body));
    expect(watching).toHaveLength(1);
    expect(observers.some((o) => o.targets.includes(base))).toBe(true);
    expect(levelDivs()).toEqual(["2"]);

    // 창이 커지면 CSS 가 맞춤 크기를 키운다 — 본문의 관찰만 불려도 새 크기를 따른다
    bodyRect = { height: 1800, left: 0, top: 0, width: 2400 };
    baseRect = centered(2204);
    act(() => watching[0].callback());
    expect(levelDivs()).toEqual(["1"]);
    expect(tiles(1)).toHaveLength(192);
  });

  test("a scroll that changes no tile does not re-render, and a re-layout keeps each surviving <img>", () => {
    baseRect = centered(4000); // 레벨 1, 가로 16 칸 중 일부만 보인다
    const commits = vi.fn();
    render(
      <Profiler id="layer" onRender={commits}>
        <Harness onReady={vi.fn()} />
      </Profiler>,
    );
    const body = document.querySelector(".body")!;
    expect(levelDivs()).toEqual(["1"]);
    const before = tiles(1);
    expect(before.length).toBeLessThan(192);
    const committed = commits.mock.calls.length;

    // 같은 사각형에서의 스크롤 — 키도 위치도 그대로라 커밋이 없다
    fireEvent.scroll(body);
    expect(commits.mock.calls.length).toBe(committed);

    // 가로로 스크롤 — 새 타일이 붙고, 남는 타일은 같은 요소다
    baseRect = { ...baseRect, left: baseRect.left - 600 };
    fireEvent.scroll(body);
    const after = tiles(1);
    const kept = before.filter((img) => after.includes(img));
    expect(kept.length).toBeGreaterThan(0);
    expect(after.some((img) => !before.includes(img))).toBe(true);
    expect(kept.every((img) => img.isConnected)).toBe(true);

    // 같은 레벨 안의 줌 — 위치가 바뀌어도 같은 키는 같은 요소다. 같은 레벨이라 밑 레이어도 없다
    const sample = after.find((img) => tileKey(img) === "1/9_5")!;
    const width = sample.style.width;
    relayout({ ...centered(3800), left: baseRect.left });
    expect(levelDivs()).toEqual(["1"]);
    expect(sample.isConnected).toBe(true);
    expect(sample.style.width).not.toBe(width);
  });

  test("an empty layout (a base not laid out yet) neither settles nor calls onReady", () => {
    // 사각형이 0 이면 배치가 비고, 빈 배치의 "모든 타일이 끝났다" 는 공허하게 참이다
    baseRect = { height: 0, left: 0, top: 0, width: 0 };
    const onReady = vi.fn();
    render(<Harness onReady={onReady} />);
    expect(document.querySelectorAll(".image-tile-layer img")).toHaveLength(0);
    expect(onReady).not.toHaveBeenCalled();

    relayout(centered(1102));
    expect(levelDivs()).toEqual(["2"]);
    expect(onReady).not.toHaveBeenCalled();
    loadAll(2);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  test("without ResizeObserver it still lays out and follows scroll", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Harness onReady={vi.fn()} />);
    expect(tiles(2)).toHaveLength(48);
    baseRect = centered(4408);
    fireEvent.scroll(document.querySelector(".body")!);
    expect(levelDivs()).toEqual(["0"]);
  });
});

// 알파 세트 — 로드·디코드를 마친 타일만 `data-tile-painted`(media.css 가 그 타일에 배경을 깔아 반투명 픽셀이 한 번만
// 합성된다). jsdom 에는 `decode` 가 없어 시험마다 목으로 단다.
describe("ImageTileLayer alpha sets", () => {
  const ALPHA: TileSetTiles = { ...SET, ext: "png" };
  const proto = HTMLImageElement.prototype as { decode?: () => Promise<void> };
  const hadDecode = "decode" in proto;
  const savedDecode = proto.decode;

  afterEach(() => {
    if (hadDecode) proto.decode = savedDecode;
    else delete proto.decode;
  });

  const root = () => document.querySelector<HTMLElement>(".image-tile-layer")!;
  const painted = (img: HTMLImageElement) =>
    img.hasAttribute("data-tile-painted");
  const flush = () => act(async () => {});

  test("an alpha tile gets data-tile-painted after load and decode, an opaque one never does", async () => {
    proto.decode = () => Promise.resolve();
    render(<Harness onReady={vi.fn()} set={ALPHA} />);
    expect(root().hasAttribute("data-tile-alpha")).toBe(true);
    const [img] = tiles(2);
    expect(painted(img)).toBe(false);
    fireEvent.load(img);
    await flush();
    expect(painted(img)).toBe(true);
    // 로드되지 않은 형제는 표시가 없다
    expect(painted(tiles(2)[1])).toBe(false);

    cleanup();
    render(<Harness onReady={vi.fn()} set={SET} />);
    expect(root().hasAttribute("data-tile-alpha")).toBe(false);
    const [opaque] = tiles(2);
    fireEvent.load(opaque);
    await flush();
    expect(painted(opaque)).toBe(false);
  });

  test("a rejected decode leaves the tile unpainted", async () => {
    proto.decode = () => Promise.reject(new Error("broken"));
    render(<Harness onReady={vi.fn()} set={ALPHA} />);
    const [img] = tiles(2);
    fireEvent.load(img);
    await flush();
    expect(painted(img)).toBe(false);
  });

  test("an error event leaves the tile unpainted", async () => {
    proto.decode = () => Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Harness onReady={vi.fn()} set={ALPHA} />);
    const [img] = tiles(2);
    fireEvent.error(img);
    await flush();
    expect(painted(img)).toBe(false);
  });

  test("a tile detached before decode resolves is not marked", async () => {
    let resolve!: () => void;
    proto.decode = () =>
      new Promise<void>((r) => {
        resolve = r;
      });
    render(<Harness onReady={vi.fn()} set={ALPHA} />);
    const [img] = tiles(2);
    fireEvent.load(img);
    img.remove();
    resolve();
    await flush();
    expect(painted(img)).toBe(false);
  });

  test("without decode (jsdom) the tile is marked right on load", () => {
    delete proto.decode;
    render(<Harness onReady={vi.fn()} set={ALPHA} />);
    const [img] = tiles(2);
    expect(painted(img)).toBe(false);
    fireEvent.load(img);
    expect(painted(img)).toBe(true);
  });
});

describe("media.css alpha tile background", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/styles/editor/media.css"),
    "utf8",
  );
  const backgroundOf = (selector: string): null | string => {
    const start = css.indexOf(`\n${selector} {`);
    if (start < 0) return null;
    const body = css.slice(start, css.indexOf("}", start));
    return /background:\s*([^;]+);/.exec(body)?.[1].trim() ?? null;
  };

  test("the painted alpha tile paints the same background as the modal", () => {
    const tile = backgroundOf(
      ".image-tile-layer[data-tile-alpha] img[data-tile-painted]",
    );
    // 선택자가 없으면 아래 비교가 공허하게 통과하지 못한다
    expect(tile).not.toBeNull();
    expect(tile).toBe(backgroundOf(".image-view-fullscreen-modal"));
  });
});
