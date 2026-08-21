// §56d Photo Gallery — 전체 화면 보기.
//
// 그리는 것은 원본이 아니라 2048px 프리뷰다(usePhotoPreview). 실측 저널의 사진은 최대
// 199 MPix이고, 그 한 장을 원본으로 걸면 웹뷰가 ~600MB를 디코드하는 동안 화면이 멈춘다 —
// 전체 화면을 채우는 데 필요한 픽셀은 그 20분의 1도 안 된다.
//
// 그래서 원본에 닿는 길은 "원본 보기"로 남긴다(에디터 본문과 같은 컴포넌트·같은 동작).
// 프리뷰로 바꾼 대가로 원본을 아예 볼 수 없게 되면 그건 고침이 아니다.
import { useEffect, useState } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

import type { PhotoGalleryEntry } from "../../utils/journal/journal-photo";

import { cachedThumbUrl } from "../../utils/journal/photo-thumbnail";
import { ImageOriginalView } from "../editor/ImageOriginalView";
import { usePhotoPreview } from "./use-photo-thumb";

export function PhotoLightbox({
  onClose,
  onNavigate,
  onOpenJournal,
  photo,
}: {
  onClose: () => void;
  onNavigate: (direction: "next" | "prev") => void;
  onOpenJournal: (journalPath: string) => void;
  photo: PhotoGalleryEntry;
}) {
  const preview = usePhotoPreview(photo.absolutePath);
  const placeholder = cachedThumbUrl(photo.absolutePath);
  const [viewingOriginal, setViewingOriginal] = useState(false);

  /**
   * ‼️ 라이트박스의 키보드는 **여기서** 처리한다 — 예전에는 PhotoGalleryPanel의 effect가
   * 했다. 원본 보기가 열리면 그쪽도 `window`에 Esc를 걸므로, 패널이 따로 듣고 있으면 Esc
   * 한 번에 원본 보기와 라이트박스가 **같이** 닫힌다. 두 리스너 모두 window에 있어
   * stopPropagation으로는 막을 수 없고(먼저 등록된 쪽이 먼저 돈다), 위에 뭐가 떠 있는지
   * 아는 것은 그 상태를 가진 이 컴포넌트뿐이다.
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (viewingOriginal) return; // 맨 위 레이어가 자기 Esc를 처리한다
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onNavigate("prev");
      else if (e.key === "ArrowRight") onNavigate("next");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onNavigate, viewingOriginal]);

  return (
    <div className="photo-lightbox-overlay" onClick={onClose}>
      {/* Nav buttons fixed to overlay edges */}
      <button
        className="photo-lightbox-nav photo-lightbox-prev"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate("prev");
        }}
      >
        <svg
          fill="none"
          height="20"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="20"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <button
        className="photo-lightbox-nav photo-lightbox-next"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate("next");
        }}
      >
        <svg
          fill="none"
          height="20"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="20"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      <button
        className="photo-lightbox-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <svg
          fill="none"
          height="18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="18"
        >
          <line x1="18" x2="6" y1="6" y2="18" />
          <line x1="6" x2="18" y1="6" y2="18" />
        </svg>
      </button>

      <div
        className="photo-lightbox-content"
        onClick={(e) => e.stopPropagation()}
      >
        {/*
          프리뷰가 아직 없으면 **그리드 썸네일을 늘려** 보여 준다. 사용자가 방금 누른 칸의
          320px 썸네일은 이미 캐시에 있으므로 즉시 뜨고, 큰 프리뷰가 만들어지는 동안 화면이
          비지 않는다. 늘린 것임을 감추지 않으려고 살짝 흐리게 둔다.
        */}
        {(preview ?? placeholder) && (
          <img
            alt={photo.caption || photo.filename}
            className={
              preview
                ? "photo-lightbox-img"
                : "photo-lightbox-img photo-lightbox-img-placeholder"
            }
            decoding="async"
            src={(preview ?? placeholder)!.url}
          />
        )}
        <div className="photo-lightbox-info">
          <span className="photo-lightbox-caption">
            {photo.caption || photo.filename}
          </span>
          <span className="photo-lightbox-date">
            {photo.date.toLocaleDateString("ko-KR")}
          </span>
          <button
            className="photo-lightbox-view-original"
            onClick={() => setViewingOriginal(true)}
          >
            원본 보기
          </button>
          {photo.journalPath && (
            <button
              className="photo-lightbox-open-journal"
              onClick={() => {
                const journalPath = photo.journalPath!;
                onClose();
                onOpenJournal(journalPath);
              }}
            >
              일기 보기
            </button>
          )}
        </div>
      </div>
      {viewingOriginal && (
        <ImageOriginalView
          alt={photo.caption || photo.filename}
          onClose={() => setViewingOriginal(false)}
          originalUrl={convertFileSrc(photo.absolutePath)}
          previewUrl={preview?.url ?? placeholder?.url ?? null}
        />
      )}
    </div>
  );
}
