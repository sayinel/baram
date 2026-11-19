// §397 원본 보기의 타일 레이어 — 바닥 요소(프리뷰 `<img>`) 위에, 지금 배율에 맞는 레벨의 보이는 타일만
// 겹쳐 그린다. 설계: spec 0078 D5(레이어 · 레벨 · 이전 레벨 남기기) · D7(타일 한 장의 실패).
//
// DOM 계약(원본 보기의 CSS 와 앱 측정 하니스가 기대는 것): 루트 `div.image-tile-layer`(`aria-hidden`)는 바닥 요소의
// `offsetLeft` · `offsetTop` 에 놓이고, 그 안에 레벨마다 `div[data-tile-level]`, 그 안에 타일 `<img>` 가
// 인라인 스타일의 좌표(바닥 요소 기준 CSS px)로 놓인다. 레벨 div 가 둘이면 앞이 밑 레이어다 — 나중 형제가
// 위에 그려진다.
//
// 밑 레이어(spec D5 "레벨이 바뀌면 이전 레벨을 그 밑에 남긴다"): 마지막으로 **다 끝난** 레벨을, 새 레벨의
// 지금 배치가 다 끝날 때까지 지금 사각형에 다시 배치해 남긴다. 그 레벨에서 **로드된** 키만 붙인다 —
// 800% 에서 맞춤으로 줄이면 레벨 0 을 맞춤 크기로 배치한 768 장(16320x12240 사진)이 다 보이는 범위에 들고,
// 그것을 다 붙이면 원본 전체를 디코드한다. 같은 레벨 안의 스크롤은 밑 레이어를 두지 않는다.
import type { JSX, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { TileSetTiles } from "../../ipc/image-tiles";
import type { PlacedTile } from "../../utils/image-tiles/tile-layout";

import { tileUrl } from "../../ipc/image-tiles";
import {
  layoutTiles,
  layoutTilesAtLevel,
} from "../../utils/image-tiles/tile-layout";

/** 한 레벨에서 끝난(load · error) 타일 — 키마다 로드됐으면 true, 실패했으면 false. */
interface LevelOutcomes {
  level: number;
  outcomes: Map<string, boolean>;
}

/** 렌더하는 것. 같은 값이면 `setPlacement` 를 부르지 않는다(`samePlacement`). */
interface Placement {
  left: number;
  level: number;
  set: TileSetTiles;
  tiles: PlacedTile[];
  top: number;
  /** 밑 레이어 — 마지막으로 다 끝난 레벨에서 로드된 타일. 없으면 빈 배열. */
  under: PlacedTile[];
}

/** 한 피라미드(`set`)를 그리는 동안의 기록. `set` 이 바뀌면 새로 만든다. */
interface Track {
  /** 지금 레벨의 마지막 배치. */
  layout: { level: number; tiles: PlacedTile[] };
  /** 지금 레벨이 `settled` 와 다를 때 그 레벨에서 끝난 타일. 같으면 null 이고 `settled` 에 쌓는다. */
  pending: LevelOutcomes | null;
  ready: boolean;
  set: TileSetTiles;
  /** 마지막으로 다 끝난 레벨 — 그 레벨이 지금 레벨인 동안 끝난 타일이 계속 쌓인다. */
  settled: LevelOutcomes | null;
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
      pending: null,
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
    (from: TileSetTiles, tile: PlacedTile, loaded: boolean) => {
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
      const record =
        track.settled?.level === tile.level
          ? track.settled
          : track.pending?.level === tile.level
            ? track.pending
            : null;
      if (!record) return;
      record.outcomes.set(tile.key, loaded);
      // 새 레벨이 방금 다 끝났다 — 다시 재서 밑 레이어를 걷고 처음이면 `onReady`
      if (track.pending && layoutSettled(track)) syncRef.current();
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
  return (
    <div
      aria-hidden
      className="image-tile-layer"
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
              onError={() => settle(set, tile, false)}
              onLoad={() => settle(set, tile, true)}
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

/** 지금 레벨의 배치가 비어 있지 않고 그 타일이 모두 끝났다(load 든 error 든). */
function layoutSettled(track: Track): boolean {
  const { level, tiles } = track.layout;
  const record = track.settled?.level === level ? track.settled : track.pending;
  return (
    tiles.length > 0 &&
    record !== null &&
    tiles.every((tile) => record.outcomes.has(tile.key))
  );
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
  if (track.settled?.level === level) track.pending = null;
  else if (track.pending?.level !== level) {
    // 다른 레벨로 — 끝나지 못한 중간 레벨의 기록은 버린다. 밑 레이어는 여전히 `settled` 다
    track.pending = { level, outcomes: new Map() };
  }
  if (track.pending && layoutSettled(track)) {
    track.settled = track.pending;
    track.pending = null;
    if (!track.ready) {
      track.ready = true;
      onReady();
    }
  }
  const { settled } = track;
  const under =
    settled && settled.level !== level
      ? layoutTilesAtLevel(set, settled.level, baseRect, view, dpr).filter(
          (tile) => settled.outcomes.get(tile.key) === true,
        )
      : [];
  const next: Placement = {
    left: base.offsetLeft,
    level,
    set,
    tiles,
    top: base.offsetTop,
    under,
  };
  if (track.shown && samePlacement(track.shown, next)) return null;
  track.shown = next;
  return next;
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
