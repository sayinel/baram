// §397 타일 배치 — 순수 함수. DOM · Tauri 를 import 하지 않는다.
import type { TileSetTiles } from "../../ipc/image-tiles";

export interface PlacedTile {
  col: number;
  h: number;
  /** `${level}/${col}_${row}` */
  key: string;
  level: number;
  row: number;
  w: number;
  /** 바닥 요소 기준 CSS px */
  x: number;
  y: number;
}

export interface Rect {
  height: number;
  left: number;
  top: number;
  width: number;
}

/**
 * 그려지는 장치 픽셀 폭보다 거칠지 않은 가장 거친 레벨.
 * `drawnDevicePx <= 0` 이면 마지막 레벨.
 */
export function chooseLevel(
  originalWidth: number,
  levelCount: number,
  drawnDevicePx: number,
): number {
  const last = Math.max(0, levelCount - 1);
  if (!(drawnDevicePx > 0)) return last;
  const level = Math.floor(Math.log2(originalWidth / drawnDevicePx));
  return Math.min(last, Math.max(0, level));
}

/**
 * `base`(바닥 요소) · `view`(스크롤 영역)는 같은 좌표계(뷰포트)다.
 * 레벨은 dpr 로 고른다.
 */
export function layoutTiles(
  set: TileSetTiles,
  base: Rect,
  view: Rect,
  dpr: number,
  margin = 1,
): { level: number; tiles: PlacedTile[] } {
  const level = chooseLevel(set.width, set.levels.length, base.width * dpr);
  return {
    level,
    tiles: layoutTilesAtLevel(set, level, base, view, dpr, margin),
  };
}

/**
 * 정해 준 레벨을 현재 `base` 크기에 맞춰 배치한다 — 줌 직후 새 레벨이 덜 찬 동안
 * 이전 레벨을 현재 크기로 아래에 깔 때 쓴다. 위치 · 끝은 `Math.round(v * dpr) / dpr`
 * 이고 이웃 타일은 같은 식에서 나온 경계를 공유한다.
 */
export function layoutTilesAtLevel(
  set: TileSetTiles,
  level: number,
  base: Rect,
  view: Rect,
  dpr: number,
  margin = 1,
): PlacedTile[] {
  const dim = set.levels[level];
  if (!dim || base.width <= 0 || base.height <= 0 || dpr <= 0) return [];
  const cols = Math.ceil(dim.w / set.tile);
  const rows = Math.ceil(dim.h / set.tile);
  // 레벨 픽셀 단위로 본 보이는 범위(바닥 기준) — 가장자리는 margin 타일만큼 넓힌다
  const range = (
    viewStart: number,
    viewEnd: number,
    baseStart: number,
    baseSize: number,
    levelSize: number,
    count: number,
  ): [number, number] => {
    const toLevel = levelSize / baseSize;
    const from = (viewStart - baseStart) * toLevel - margin * set.tile;
    const to = (viewEnd - baseStart) * toLevel + margin * set.tile;
    return [
      Math.max(0, Math.floor(from / set.tile)),
      Math.min(count - 1, Math.ceil(to / set.tile) - 1),
    ];
  };
  const [c0, c1] = range(
    view.left,
    view.left + view.width,
    base.left,
    base.width,
    dim.w,
    cols,
  );
  const [r0, r1] = range(
    view.top,
    view.top + view.height,
    base.top,
    base.height,
    dim.h,
    rows,
  );
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  const edge = (index: number, levelSize: number, baseSize: number) =>
    snap((Math.min(index * set.tile, levelSize) / levelSize) * baseSize);
  const tiles: PlacedTile[] = [];
  for (let row = r0; row <= r1; row++) {
    const y = edge(row, dim.h, base.height);
    const bottom = edge(row + 1, dim.h, base.height);
    for (let col = c0; col <= c1; col++) {
      const x = edge(col, dim.w, base.width);
      const right = edge(col + 1, dim.w, base.width);
      tiles.push({
        col,
        h: bottom - y,
        key: `${level}/${col}_${row}`,
        level,
        row,
        w: right - x,
        x,
        y,
      });
    }
  }
  return tiles;
}
