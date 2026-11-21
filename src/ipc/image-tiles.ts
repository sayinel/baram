// §397 원본 보기 타일 IPC — Rust `image_tiles` 명령의 래퍼
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";

export interface TileLevel {
  h: number;
  w: number;
}

export type TileSet = TileSetTiles | { kind: "original" };

export interface TileSetTiles {
  bytes: number;
  dir: string;
  ext: "jpg" | "png";
  height: number;
  kind: "tiles";
  /** 레벨 0 이 원본 크기이고, 다음 레벨마다 올림 절반이다. */
  levels: TileLevel[];
  tile: number;
  width: number;
}

export interface TileSize {
  height: number;
  width: number;
}

/**
 * 사진의 타일 피라미드를 돌려받는다. `original` 이면 타일이 필요 없는 사진이다.
 * `onSize` 는 피라미드를 새로 만들어야 할 때만, 만들기 전에 한 번 불린다
 * (캐시 적중 · `original` 응답에는 불리지 않는다). 거절 · 실패는 문자열로 reject.
 */
export async function imageTiles(
  path: string,
  onSize: (size: TileSize) => void,
): Promise<TileSet> {
  const channel = new Channel<TileSize>();
  channel.onmessage = onSize;
  return invoke<TileSet>("image_tiles", { onSize: channel, path });
}

/** 타일 한 장의 asset URL. 파일은 `${dir}/${level}/${col}_${row}.${ext}`. */
export function tileUrl(
  set: TileSetTiles,
  level: number,
  col: number,
  row: number,
): string {
  return convertFileSrc(`${set.dir}/${level}/${col}_${row}.${set.ext}`);
}
