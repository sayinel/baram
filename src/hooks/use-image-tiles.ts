// §397 원본 보기 — 원본 경로의 타일 피라미드를 Rust `image_tiles` 에 묻고 뷰어의 상태로 돌려준다.
// 설계: spec 0078 D2(크기를 먼저 알린다) · D5(경로가 있을 때만 묻는다) · D7(폴백).
import { useEffect, useState } from "react";

import type { TileSetTiles, TileSize } from "../ipc/image-tiles";

import { imageTiles } from "../ipc/image-tiles";

export type ImageTilesState =
  | { set: null; size: null; status: "original" }
  | { set: null; size: null | TileSize; status: "pending" }
  | { set: TileSetTiles; size: TileSize; status: "tiles" };

const ORIGINAL: ImageTilesState = { set: null, size: null, status: "original" };
const PENDING: ImageTilesState = { set: null, size: null, status: "pending" };

/**
 * `pending`(크기는 피라미드를 새로 만들 때만 먼저 온다) → `tiles` 또는 `original`.
 * `path` 가 null 이면(원격 · data URI) 첫 렌더부터 `original` 이고 Rust 를 부르지 않는다.
 * 거절과 `kind: "original"` 은 둘 다 `original` 이다. 여기서는 로그를 남기지 않는다 — 피라미드를 읽거나
 * 만들다 난 실패는 Rust `image_tiles` 가 남기고(`probe_tiles` · `ensure_tiles` 의 `Err`), 경로 검사 · 인가 거절은
 * 그 명령도 남기지 않는다.
 *
 * 답은 그것을 물은 경로와 함께 둔다. 경로가 바뀐 첫 렌더부터 이전 경로의 답을 보이지 않고,
 * 언마운트 · 경로 변경 뒤에 온 크기 · 답은 effect 정리가 내린 `live` 에 막혀 버려진다. 답이 온 뒤의
 * 크기도 같은 관문으로 버린다 — `tiles` 를 `pending` 으로 되돌리지 않게.
 */
export function useImageTiles(path: null | string): ImageTilesState {
  const [answer, setAnswer] = useState<null | {
    path: string;
    state: ImageTilesState;
  }>(null);

  useEffect(() => {
    if (path === null) return;
    let live = true;
    imageTiles(path, (size) => {
      if (live)
        setAnswer({ path, state: { set: null, size, status: "pending" } });
    }).then(
      (result) => {
        if (!live) return;
        live = false;
        setAnswer({
          path,
          state:
            result.kind === "tiles"
              ? {
                  set: result,
                  size: { height: result.height, width: result.width },
                  status: "tiles",
                }
              : ORIGINAL,
        });
      },
      () => {
        if (!live) return;
        live = false;
        setAnswer({ path, state: ORIGINAL });
      },
    );
    return () => {
      live = false;
    };
  }, [path]);

  if (path === null) return ORIGINAL;
  return answer?.path === path ? answer.state : PENDING;
}
