// §397 원본 보기의 타일 레이어 — 바닥 요소(프리뷰 `<img>`) 위에, 지금 배율에 맞는 레벨의 보이는 타일만
// 겹쳐 그린다. 설계: spec 0078 D5(레이어 · 레벨 · 이전 레벨 남기기) · D7(타일 한 장의 실패).
//
// DOM 계약(원본 보기의 CSS 와 앱 측정 하니스가 기대는 것): 루트 `div.image-tile-layer`(`aria-hidden`)는 본문
// (스크롤 영역)의 패딩 상자 안에서 바닥 요소가 놓인 자리를 기기 픽셀에 맞춘 곳에 놓이고(`rootOffset`), 그 안에
// 레벨마다 `div[data-tile-level]`, 그 안에 타일 `<img>` 가 인라인 스타일의 좌표(바닥 요소 기준 CSS px)로
// 놓인다. 레벨 div 가 둘이면 앞이 밑 레이어다 — 나중 형제가 위에 그려진다.
//
// 알파가 있는 원본(`set.ext === "png"`)의 속성 둘: 루트의 `data-tile-alpha`, 그리고 그 루트 안에서 로드를 마치고
// 디코드된 타일 `<img>` 의 `data-tile-painted`(`markPainted`). media.css 의 규칙이 이 둘이 함께 있는 타일에만
// 배경색을 깔아, 그 타일의 반투명 픽셀이 밑(바닥 프리뷰 · 밑 레이어)과 겹쳐 두 번 합성되지 않게 한다. 불투명
// 세트에는 어느 속성도 붙지 않는다.
//
// 밑 레이어(spec D5 "레벨이 바뀌면 이전 레벨을 그 밑에 남긴다"): 마지막으로 **다 끝난** 레벨을, 새 레벨의
// 지금 배치가 다 끝날 때까지 지금 사각형에 다시 배치해 남긴다. 남기는 것은 그 레벨의 `<img>` 중 **지금
// 붙어 있고 로드된** 것뿐이다 — 밑 레이어는 새 요소를 만들지 않으므로, 그 수는 그 레벨이 지금 레벨이던
// 마지막 배치(보이는 범위 + 사방 1 타일)를 넘지 않고 다시 배치해도 늘지 않는다. 800% 에서 맞춤으로 줄이면
// 레벨 0 을 맞춤 크기로 배치한 768 장(16320x12240 사진)이 다 범위에 드는데, 그중 800% 에서 붙어 있던
// 로드된 것만 남는다. 같은 레벨 안의 스크롤은 밑 레이어를 두지 않는다.
import type { JSX, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { TileSetTiles } from "../../ipc/image-tiles";
import type { PlacedTile } from "../../utils/image-tiles/tile-layout";

import { tileUrl } from "../../ipc/image-tiles";
import {
  layoutTiles,
  layoutTilesAtLevel,
} from "../../utils/image-tiles/tile-layout";

/**
 * 한 레벨에서 끝난(load · error) 타일 `<img>` — 키마다 그 요소와 로드됐는지. 기록은 그 요소가 문서에 붙어
 * 있는 동안만 뜻이 있다(`mountedOutcome`). 배치를 떠난 타일의 요소는 떼어지고, 돌아오면 새 요소라 다시 받는다.
 */
type LevelOutcomes = Map<string, { el: HTMLImageElement; loaded: boolean }>;

/** 렌더하는 것. 같은 값이면 `setPlacement` 를 부르지 않는다(`samePlacement`). */
interface Placement {
  left: number;
  level: number;
  set: TileSetTiles;
  tiles: PlacedTile[];
  top: number;
  /** 밑 레이어 — 마지막으로 다 끝난 레벨에서 지금 붙어 있고 로드된 타일. 없으면 빈 배열. */
  under: PlacedTile[];
}

/** 한 피라미드(`set`)를 그리는 동안의 기록. `set` 이 바뀌면 새로 만든다. */
interface Track {
  /** 지금 레벨의 마지막 배치. */
  layout: { level: number; tiles: PlacedTile[] };
  /**
   * 레벨마다의 기록. 레벨이 바뀌어도 버리지 않고, 떼어진 요소의 기록만 `place` 가 걷는다 — 스크롤 · 크기 관찰 ·
   * 타일 결과가 부르는 배치는 커밋 하나 사이에 여러 번 올 수 있다. 레벨이 떠났다가 커밋 전에 돌아오면 React 는 그
   * 레벨의 요소를 그대로 두고, 이미 로드된 요소는 load 를 다시 쏘지 않는다. 그 기록을 버렸다면 그 요소가 붙어
   * 있는 동안 그 레벨은 끝나지 못한다.
   */
  outcomes: Map<number, LevelOutcomes>;
  ready: boolean;
  set: TileSetTiles;
  /** 마지막으로 다 끝난 레벨. 아직 없으면 null. 지금 레벨과 다르면 지금 레벨이 끝날 때까지 밑 레이어다. */
  settled: null | number;
  shown: null | Placement;
}

export function ImageTileLayer({
  baseRef,
  bodyRef,
  onReady,
  set,
}: {
  baseRef: RefObject<HTMLImageElement | null>;
  bodyRef: RefObject<HTMLElement | null>;
  /** 처음 레이어의 타일이 다 끝나면 한 번. */
  onReady: () => void;
  set: TileSetTiles;
}): JSX.Element | null {
  const [placement, setPlacement] = useState<null | Placement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const trackRef = useRef<null | Track>(null);
  const syncRef = useRef<() => void>(() => {});
  const warnedRef = useRef(false);

  // passive effect 인 이유: 같은 커밋에 붙은 ref 가 모두 붙은 뒤에 돈다. layout effect 는 자식부터 돌아
  // 부모인 본문의 ref 가 아직 비어 있을 수 있다(레이어는 본문의 자식이다).
  useEffect(() => {
    const base = baseRef.current;
    const body = bodyRef.current;
    if (!base || !body) return;
    const track: Track = {
      layout: { level: -1, tiles: [] },
      outcomes: new Map(),
      ready: false,
      set,
      settled: null,
      shown: null,
    };
    trackRef.current = track;
    const sync = () => {
      const next = place(track, base, body, () => onReadyRef.current());
      if (next) setPlacement(next);
    };
    syncRef.current = sync;
    sync();
    body.addEventListener("scroll", sync, { passive: true });
    // jsdom 처럼 ResizeObserver 가 없는 환경에서는 크기 변화에 다시 재지 않는다 — 스크롤 · `set` 만.
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
    observer?.observe(base);
    observer?.observe(body);
    return () => {
      body.removeEventListener("scroll", sync);
      observer?.disconnect();
      syncRef.current = () => {};
      if (trackRef.current === track) trackRef.current = null;
    };
  }, [baseRef, bodyRef, set]);

  const settle = useCallback(
    (
      from: TileSetTiles,
      tile: PlacedTile,
      el: HTMLImageElement,
      loaded: boolean,
    ) => {
      // 붙어 있는 요소의 결과만 기록한다. react-dom 19.3.1 에서는 이 검사에 걸리는 이벤트가 없다 — 커밋의 mutation
      // 단계가 지운 fiber 의 `return` 을 끊어 `getNearestMountedFiber` 가 null 을 내므로, 지운 요소의 load · error 는
      // 인스턴스의 키가 아직 남은 passive 단계 전에도 이 핸들러에 오지 않는다(2026-11-19 jsdom 프로브). 그 보장은
      // React 내부라 우리 코드로 확인할 수 없어 여기서도 거른다: 떼어진 요소의 기록이 같은 키로 붙은 새 요소의 기록을
      // 덮으면 그 레벨은 끝나지 못한다
      if (!el.isConnected) return;
      if (!loaded && !warnedRef.current) {
        warnedRef.current = true;
        console.warn(
          "§397 a tile failed to load — the base image shows through",
          tileUrl(from, tile.level, tile.col, tile.row),
        );
      }
      const track = trackRef.current;
      // 다른 피라미드의 타일은 키가 같아도 남의 것이다
      if (!track || track.set !== from) return;
      // 지금 레벨도 끝난 레벨도 아닌 레벨의 결과도 남긴다 — 커밋 전에 그 레벨로 돌아오면 React 가 이 요소를 그대로 둔다
      let record = track.outcomes.get(tile.level);
      if (!record) {
        record = new Map();
        track.outcomes.set(tile.level, record);
      }
      record.set(tile.key, { el, loaded });
      // 새 레벨이 방금 다 끝났다 — 다시 재서 밑 레이어를 걷고 처음이면 `onReady`
      if (track.layout.level !== track.settled && layoutSettled(track)) {
        syncRef.current();
      }
    },
    [],
  );

  if (!placement || placement.set !== set) return null;
  const layers =
    placement.under.length > 0
      ? [
          { level: placement.under[0].level, tiles: placement.under },
          { level: placement.level, tiles: placement.tiles },
        ]
      : [{ level: placement.level, tiles: placement.tiles }];
  const alpha = set.ext === "png";
  return (
    <div
      aria-hidden
      className="image-tile-layer"
      data-tile-alpha={alpha ? "" : undefined}
      style={{ left: placement.left, top: placement.top }}
    >
      {layers.map((layer) => (
        <div data-tile-level={layer.level} key={layer.level}>
          {layer.tiles.map((tile) => (
            <img
              alt=""
              decoding="async"
              draggable={false}
              key={tile.key}
              onError={(e) => settle(set, tile, e.currentTarget, false)}
              onLoad={(e) => {
                settle(set, tile, e.currentTarget, true);
                if (alpha) markPainted(e.currentTarget);
              }}
              src={tileUrl(set, tile.level, tile.col, tile.row)}
              style={{
                height: tile.h,
                left: tile.x,
                top: tile.y,
                width: tile.w,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 알파가 있는 세트의 타일이 그려질 준비가 됐다는 표시(`data-tile-painted`)를 단다. `load` 가 아니라 `decode()` 가
 * 끝난 뒤에 다는 이유: 타일은 `decoding="async"` 라 `load` 시점에 배경을 깔면 이미지보다 배경만 먼저 한 프레임
 * 그려질 수 있다. 이 속성은 React 가 관리하지 않아 다시 렌더해도 그대로 남는다 — 한 요소의 `key` 와 `src` 는
 * 바뀌지 않으므로 React 가 그 요소의 속성을 되돌릴 일이 없다. `decode()` 가 거부되면(깨진 이미지) 달지 않고,
 * 기다리는 사이 떼어진 요소에도 달지 않는다. `decode` 가 없는 환경(jsdom)은 load 즉시 단다.
 */
function markPainted(el: HTMLImageElement): void {
  if (typeof el.decode !== "function") {
    el.setAttribute("data-tile-painted", "");
    return;
  }
  el.decode().then(
    () => {
      if (el.isConnected) el.setAttribute("data-tile-painted", "");
    },
    () => {},
  );
}

/** 지금 레벨의 배치가 비어 있지 않고 그 타일이 모두 붙어서 끝났다(load 든 error 든). */
function layoutSettled(track: Track): boolean {
  const { level, tiles } = track.layout;
  const record = track.outcomes.get(level);
  return (
    tiles.length > 0 &&
    record !== undefined &&
    tiles.every((tile) => mountedOutcome(record, tile.key) !== null)
  );
}

/** 지금 붙어 있는 그 키의 요소가 끝났으면 로드됐는지, 아니면(떼어졌거나 아직) null. */
function mountedOutcome(record: LevelOutcomes, key: string): boolean | null {
  const entry = record.get(key);
  return entry?.el.isConnected ? entry.loaded : null;
}

/**
 * 다시 재고 기록을 고친 뒤 렌더할 값을 돌려준다. 보이던 것과 같으면 null — 스크롤은 프레임마다 오고,
 * 같은 값을 다시 넣으면 그때마다 레이어가 다시 렌더된다.
 */
function place(
  track: Track,
  base: HTMLElement,
  body: HTMLElement,
  onReady: () => void,
): null | Placement {
  const baseRect = base.getBoundingClientRect();
  const view = body.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const { set } = track;
  const { level, tiles } = layoutTiles(set, baseRect, view, dpr);
  track.layout = { level, tiles };
  // 떼어진 요소의 기록은 다시 살지 않는다(React 는 지운 요소를 다시 붙이지 않고, 돌아온 키는 새 요소다).
  // 판정은 `mountedOutcome` 이 하고, 여기서 지우는 것은 떼어진 `<img>` 를 쥐고 있지 않으려는 것이다. 붙어 있는
  // 요소의 기록은 레벨이 바뀌어도 남긴다 — `Track.outcomes` 의 주석
  for (const [recordLevel, record] of track.outcomes) {
    for (const [key, entry] of record) {
      if (!entry.el.isConnected) record.delete(key);
    }
    if (record.size === 0) track.outcomes.delete(recordLevel);
  }
  if (level !== track.settled && layoutSettled(track)) {
    track.settled = level;
    if (!track.ready) {
      track.ready = true;
      onReady();
    }
  }
  const { settled } = track;
  const settledRecord =
    settled === null ? undefined : track.outcomes.get(settled);
  const under =
    settled !== null && settled !== level && settledRecord
      ? layoutTilesAtLevel(set, settled, baseRect, view, dpr).filter(
          (tile) => mountedOutcome(settledRecord, tile.key) === true,
        )
      : [];
  const next: Placement = {
    ...rootOffset(baseRect, view, body, dpr),
    level,
    set,
    tiles,
    under,
  };
  if (track.shown && samePlacement(track.shown, next)) return null;
  track.shown = next;
  return next;
}

/**
 * 루트의 자리 — 본문의 패딩 상자 원점(스크롤된 내용 기준)에서 바닥 요소까지를 타일 좌표와 같은 식
 * `Math.round(v * dpr) / dpr` 로 기기 픽셀에 맞춘다. 스크롤하면 바닥 요소의 사각형과 `scrollLeft` ·
 * `scrollTop` 이 같은 양만큼 반대로 움직여 값이 그대로다. `offsetLeft` · `offsetTop` 을 쓰지 않는 이유:
 * 정수로 반올림되어, 소수 자리에 놓인 바닥 요소(`margin: auto` 가운데 맞춤)와 dpr 2 에서 기기 픽셀 하나만큼
 * 어긋난다.
 */
function rootOffset(
  baseRect: DOMRect,
  view: DOMRect,
  body: HTMLElement,
  dpr: number,
): { left: number; top: number } {
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  return {
    left: snap(baseRect.left - view.left - body.clientLeft + body.scrollLeft),
    top: snap(baseRect.top - view.top - body.clientTop + body.scrollTop),
  };
}

function samePlacement(a: Placement, b: Placement): boolean {
  return (
    a.set === b.set &&
    a.level === b.level &&
    a.left === b.left &&
    a.top === b.top &&
    sameTiles(a.tiles, b.tiles) &&
    sameTiles(a.under, b.under)
  );
}

function sameTiles(a: PlacedTile[], b: PlacedTile[]): boolean {
  return (
    a.length === b.length &&
    a.every((tile, i) => {
      const other = b[i];
      return (
        tile.key === other.key &&
        tile.x === other.x &&
        tile.y === other.y &&
        tile.w === other.w &&
        tile.h === other.h
      );
    })
  );
}
