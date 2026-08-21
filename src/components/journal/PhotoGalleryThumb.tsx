// §56d Photo Gallery — 한 칸. 썸네일이 준비되기 전에는 <img>를 만들지 않는다.
//
// ‼️ "일단 원본을 걸고 나중에 바꾼다"가 아니다. 원본을 한 번 걸면 그 시점에 브라우저가
// 원본을 통째로 디코드한다 — 100px 칸에 그리려는 것이라도 그렇다. 실측 저널의 사진은 평균
// 17.7 MPix(최대 199 MPix)라 Year 뷰 한 번이 RGBA 12.2GB를 요구했고, 유휴 메모리 목표는
// 100MB다(Part 8 §8.4). 그 압박에서 WKWebView는 디코드된 비트맵을 버리므로, 리페인트가
// 한 번 일어나면 그리드 전체가 플레이스홀더로 되돌아가 번쩍인다.
import { memo, useRef } from "react";

import type { PhotoGalleryEntry } from "../../utils/journal/journal-photo";

import {
  PREVIEW_MAX_PX,
  resolveThumbUrl,
} from "../../utils/journal/photo-thumbnail";
import { useVisibleThumb } from "./use-photo-thumb";

export const PhotoGalleryThumb = memo(function PhotoGalleryThumb({
  onOpen,
  photo,
}: {
  onOpen: (photo: PhotoGalleryEntry) => void;
  photo: PhotoGalleryEntry;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const thumb = useVisibleThumb(holderRef, photo.absolutePath);

  return (
    <div
      className="photo-gallery-item"
      onClick={() => onOpen(photo)}
      // 누르기 전에 라이트박스가 쓸 크기를 미리 만들어 둔다. 사람은 클릭할 칸에 먼저
      // 마우스를 올리므로, 그 사이(수백 ms)에 프리뷰가 준비되면 흐린 자리표시가 아예
      // 보이지 않는다. 스크롤 중 지나친 칸까지 만들지는 않는다 — hover한 것만이다.
      onMouseEnter={() =>
        void resolveThumbUrl(photo.absolutePath, PREVIEW_MAX_PX)
      }
      ref={holderRef}
      title={photo.caption || photo.filename}
    >
      {thumb && (
        <img
          alt={photo.caption || photo.filename}
          className="photo-gallery-thumb"
          // 개발자 도구에서 한 눈에 보이는 표식. `original`이 하나라도 있으면 그 사진은
          // 수정 전과 같은 비용으로 그려지고 있다는 뜻이다(콘솔 경고와 같은 사건).
          data-thumb-source={thumb.isOriginal ? "original" : "cache"}
          decoding="async"
          src={thumb.url}
        />
      )}
      {photo.caption && (
        <span className="photo-gallery-item-caption">{photo.caption}</span>
      )}
    </div>
  );
});
