// §56d Photo Gallery — 사진 한 장의 표시용 URL을 얻는 훅 둘.
//
// 두 훅이 공통으로 지키는 규칙: **준비되기 전에는 null을 준다.** 호출자가 그동안 원본을
// 걸어 두면 안 되기 때문이다 — 100px 칸에 그리려는 것이라도 브라우저는 원본을 통째로
// 디코드하고, 실측 저널의 사진은 평균 17.7 MPix(최대 199 MPix)다.
import { useEffect, useState } from "react";

import { onFirstVisible } from "../../extensions/nodes/views/lazy-visible";
import {
  cachedThumbUrl,
  PREVIEW_MAX_PX,
  resolveThumbUrl,
  type ThumbUrl,
} from "../../utils/journal/photo-thumbnail";

/**
 * 전체 화면용. 썸네일로는 안 되지만 원본일 필요도 없다 — 2048px 프리뷰가 Retina 전체 화면을
 * 채우면서 디코드를 199 MPix에서 4 MPix로 줄인다. 화면에 들어오는 것을 기다리지 않는다:
 * 이 훅이 마운트되는 시점이 곧 사용자가 그 사진을 연 시점이다.
 */
export function usePhotoPreview(absolutePath: null | string): null | ThumbUrl {
  const [thumb, setThumb] = useState<null | ThumbUrl>(() =>
    absolutePath ? cachedThumbUrl(absolutePath, PREVIEW_MAX_PX) : null,
  );

  useEffect(() => {
    // ‼️ null은 "아직 모른다"가 아니라 "만들 프리뷰가 없다"다 — 동영상이 그렇다.
    // Rust 썸네일러는 mp4를 디코드할 수 없어 반드시 실패하고, 그 실패는 일부러
    // 시끄럽다(console.warn + 원본 폴백). 아예 묻지 않는 것이 맞다.
    if (!absolutePath) {
      setThumb(null);
      return;
    }
    const cached = cachedThumbUrl(absolutePath, PREVIEW_MAX_PX);
    setThumb(cached);
    if (cached) return;

    let alive = true;
    resolveThumbUrl(absolutePath, PREVIEW_MAX_PX).then((r) => {
      if (alive) setThumb(r);
    });
    return () => {
      alive = false;
    };
  }, [absolutePath]);

  return thumb;
}

/**
 * 칸이 화면(±200px)에 처음 들어오면 true가 되고, 그 뒤로는 계속 true다.
 *
 * 썸네일 URL을 얻는 두 훅과 같은 큐(`onFirstVisible`)를 쓴다 — 다른 이유로 같은 일을
 * 하는 두 번째 스케줄러를 만들지 않으려는 것이다. 이쪽 소비자(동영상 칸)는 IPC가 아니라
 * `<video>` 엘리먼트 자체를 미룬다: 웹뷰가 잡는 디코더와 moov atom 요청이 비용이다.
 */
export function useVisibleOnce(
  holderRef: React.RefObject<HTMLElement | null>,
): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;

    let alive = true;
    const dispose = onFirstVisible(el, () => {
      if (alive) setVisible(true);
    });
    return () => {
      alive = false;
      dispose();
    };
  }, [holderRef]);

  return visible;
}

/**
 * 칸이 화면(±200px)에 처음 들어올 때 한 번 썸네일을 요청한다.
 *
 * 한꺼번에 요청하지 않는 이유가 성능만은 아니다. 사진 177장이면 IPC 요청 177건이 큐에 쌓이고,
 * 그 뒤에 사용자가 누른 "일기 보기"의 readFile이 선다 — 저널이 몇 초 뒤에 뜨는 증상이 그것이다.
 * `onFirstVisible`은 idle 틱마다 한 건씩 흘리므로 보이는 칸이 먼저, 하나씩 채워진다.
 */
export function useVisibleThumb(
  holderRef: React.RefObject<HTMLElement | null>,
  absolutePath: string,
): null | ThumbUrl {
  const [thumb, setThumb] = useState<null | ThumbUrl>(() =>
    cachedThumbUrl(absolutePath),
  );

  useEffect(() => {
    const cached = cachedThumbUrl(absolutePath);
    if (cached) {
      setThumb(cached);
      return;
    }
    setThumb(null);

    const el = holderRef.current;
    if (!el) return;

    let alive = true;
    const dispose = onFirstVisible(el, () => {
      resolveThumbUrl(absolutePath).then((r) => {
        if (alive) setThumb(r);
      });
    });
    return () => {
      alive = false;
      dispose();
    };
  }, [absolutePath, holderRef]);

  return thumb;
}
