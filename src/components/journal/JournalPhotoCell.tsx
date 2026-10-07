// §56f `journal-photos` 블록의 한 칸(이슈 793). 갤러리 칸(`PhotoGalleryThumb`)과 같은 규칙이다 —
// 썸네일이 준비되기 전에는 <img>를 만들지 않는다. 원본을 "잠깐" 걸어 두는 것도 그 시점에
// 브라우저가 원본을 통째로 디코드하는 일이라(12 MP 한 장에 48 MB), 그동안 칸은 크기만 잡은
// 빈 정사각형이다. 썸네일을 만들 수 없는 파일은 갤러리처럼 원본으로 떨어지고
// (`resolveThumbUrl`이 시끄럽게 남긴다), `data-thumb-source`가 그것을 표시한다.
import { memo, useRef } from "react";

import { useVisibleThumb } from "./use-photo-thumb";

export const JournalPhotoCell = memo(function JournalPhotoCell({
  absolutePath,
  alt,
  maxPx,
  revision,
  title,
}: {
  absolutePath: string;
  alt: string;
  maxPx: number;
  /** `sourceRevision` of the file as listed — a photo replaced in place is asked for again. */
  revision: string;
  title: string;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const thumb = useVisibleThumb(holderRef, absolutePath, maxPx, revision);

  return (
    <div className="journal-photos-cell" ref={holderRef} title={title}>
      {thumb && (
        <img
          alt={alt}
          className="journal-photos-thumb"
          data-thumb-source={thumb.isOriginal ? "original" : "cache"}
          decoding="async"
          src={thumb.url}
        />
      )}
    </div>
  );
});
