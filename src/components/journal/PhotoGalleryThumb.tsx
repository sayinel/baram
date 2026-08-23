// §56d Photo Gallery — 한 칸. 사진이면 썸네일이 준비되기 전에는 <img>를 만들지 않고,
// 동영상이면 화면에 들어오기 전에는 <video>를 만들지 않는다. 같은 규칙의 두 얼굴이다.
//
// ‼️ 사진: "일단 원본을 걸고 나중에 바꾼다"가 아니다. 원본을 한 번 걸면 그 시점에 브라우저가
// 원본을 통째로 디코드한다 — 100px 칸에 그리려는 것이라도 그렇다. 실측 저널의 사진은 평균
// 17.7 MPix(최대 199 MPix)라 Year 뷰 한 번이 RGBA 12.2GB를 요구했고, 유휴 메모리 목표는
// 100MB다(Part 8 §8.4). 그 압박에서 WKWebView는 디코드된 비트맵을 버리므로, 리페인트가
// 한 번 일어나면 그리드 전체가 플레이스홀더로 되돌아가 번쩍인다.
//
// ‼️ 동영상(§293): 썸네일 기계를 아예 타지 않는다. Rust `photo_thumbnail`은 `image`
// crate이라 mp4를 디코드할 수 없어 반드시 실패하고, 그 실패 경로는 일부러 시끄럽게
// 만들어져 있다(console.warn + 원본 URL 폴백). 대신 에디터 본문이 쓰는 것과 같은 포스터
// 트릭(`#t=0.1`, §17.2-7)으로 첫 프레임만 받는다.
import { memo, useRef, useState } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

import type { PhotoGalleryEntry } from "../../utils/journal/journal-photo";

import {
  formatClipDuration,
  PREVIEW_MAX_PX,
  resolveThumbUrl,
} from "../../utils/journal/photo-thumbnail";
import { useVisibleOnce, useVisibleThumb } from "./use-photo-thumb";

export const PhotoGalleryThumb = memo(function PhotoGalleryThumb({
  onOpen,
  photo,
}: {
  onOpen: (photo: PhotoGalleryEntry) => void;
  photo: PhotoGalleryEntry;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  // `insertMediaAtPos`(drop-handler.ts)·NodeView와 같은 판정 — image가 아니면 동영상.
  const isVideo = photo.kind !== "image";

  return (
    <div
      className="photo-gallery-item"
      onClick={() => onOpen(photo)}
      // 누르기 전에 라이트박스가 쓸 크기를 미리 만들어 둔다. 사람은 클릭할 칸에 먼저
      // 마우스를 올리므로, 그 사이(수백 ms)에 프리뷰가 준비되면 흐린 자리표시가 아예
      // 보이지 않는다. 스크롤 중 지나친 칸까지 만들지는 않는다 — hover한 것만이다.
      // 동영상에는 만들 프리뷰가 없다(라이트박스가 파일 자체를 재생한다).
      onMouseEnter={
        isVideo
          ? undefined
          : () => void resolveThumbUrl(photo.absolutePath, PREVIEW_MAX_PX)
      }
      ref={holderRef}
      title={photo.caption || photo.filename}
    >
      {isVideo ? (
        <ClipPoster holderRef={holderRef} photo={photo} />
      ) : (
        <PhotoThumb holderRef={holderRef} photo={photo} />
      )}
      {photo.caption && (
        <span className="photo-gallery-item-caption">{photo.caption}</span>
      )}
    </div>
  );
});

/**
 * 동영상 칸. 화면에 들어오기 전에는 아무것도 마운트하지 않는다.
 *
 * 지연 마운트가 성능만의 문제가 아닌 이유는 사진 쪽과 같다: 한 달치 `<video>`를 한꺼번에
 * 걸면 웹뷰가 그만큼의 디코더를 잡고 moov atom 요청이 큐에 쌓인다 — 그 뒤에 사용자가 누른
 * "일기 보기"의 readFile이 선다.
 */
function ClipPoster({
  holderRef,
  photo,
}: {
  holderRef: React.RefObject<HTMLElement | null>;
  photo: PhotoGalleryEntry;
}) {
  const visible = useVisibleOnce(holderRef);
  const [duration, setDuration] = useState<null | string>(null);

  if (!visible) return null;

  return (
    <>
      <video
        className="photo-gallery-thumb"
        onLoadedMetadata={(e) =>
          setDuration(formatClipDuration(e.currentTarget.duration))
        }
        // 첫 프레임만 받아 포스터로 쓴다 (§17.2-7 — video-view.tsx와 같은 트릭).
        preload="metadata"
        src={`${convertFileSrc(photo.absolutePath)}#t=0.1`}
      />
      {/* 재생 표식은 길이와 **따로** 그린다. 길이는 metadata가 와야 알 수 있지만,
          "이 칸은 동영상이다"는 그 전에도 참이다 — metadata가 끝내 오지 않아도
          (파일 손상, 코덱 미지원) 사진과 구별되지 않는 칸으로 남으면 안 된다. */}
      <span className="photo-gallery-clip-badge">
        <svg
          aria-hidden="true"
          fill="currentColor"
          height="10"
          viewBox="0 0 24 24"
          width="10"
        >
          <polygon points="6 4 20 12 6 20" />
        </svg>
        {duration && <span className="photo-gallery-duration">{duration}</span>}
      </span>
    </>
  );
}

/** 사진 칸. 썸네일 URL이 준비되기 전에는 <img>가 아예 없다. */
function PhotoThumb({
  holderRef,
  photo,
}: {
  holderRef: React.RefObject<HTMLElement | null>;
  photo: PhotoGalleryEntry;
}) {
  const thumb = useVisibleThumb(holderRef, photo.absolutePath);
  if (!thumb) return null;

  return (
    <img
      alt={photo.caption || photo.filename}
      className="photo-gallery-thumb"
      // 개발자 도구에서 한 눈에 보이는 표식. `original`이 하나라도 있으면 그 사진은
      // 수정 전과 같은 비용으로 그려지고 있다는 뜻이다(콘솔 경고와 같은 사건).
      data-thumb-source={thumb.isOriginal ? "original" : "cache"}
      decoding="async"
      src={thumb.url}
    />
  );
}
