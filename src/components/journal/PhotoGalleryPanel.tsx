// §56d Photo Gallery — full gallery view panel
import { useState, useEffect, useCallback, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useEditorStore } from "../../stores/editor-store";
import { useUIStore } from "../../stores/ui-store";
import { readFile } from "../../ipc/invoke";
import {
  scanJournalPhotos,
  groupPhotosByDate,
  type PhotoGalleryEntry,
} from "../../utils/journal-photo";

type GroupMode = "day" | "month" | "year";

export function PhotoGalleryPanel() {
  const { rightPanelOpen, rightPanelMode } = useUIStore();
  const { rootPath } = useFileStore();
  const { journalDirectory } = useSettingsStore();

  const [photos, setPhotos] = useState<PhotoGalleryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>("month");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const isVisible = rightPanelOpen && rightPanelMode === "photo-gallery";

  const loadPhotos = useCallback(async () => {
    if (!rootPath || !journalDirectory) return;
    setLoading(true);
    try {
      const result = await scanJournalPhotos(rootPath, journalDirectory);
      setPhotos(result);
    } catch {
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [rootPath, journalDirectory]);

  useEffect(() => {
    if (!isVisible) return;
    loadPhotos();
  }, [isVisible, loadPhotos]);

  const groups = useMemo(() => groupPhotosByDate(photos, groupMode), [photos, groupMode]);

  // Sort group keys descending (newest first)
  const sortedKeys = useMemo(
    () => Array.from(groups.keys()).sort((a, b) => b.localeCompare(a)),
    [groups],
  );

  // Flat list for lightbox navigation
  const flatPhotos = useMemo(() => {
    const result: PhotoGalleryEntry[] = [];
    for (const key of sortedKeys) {
      const groupPhotos = groups.get(key);
      if (groupPhotos) result.push(...groupPhotos);
    }
    return result;
  }, [groups, sortedKeys]);

  const navigateLightbox = useCallback(
    (direction: "prev" | "next") => {
      setLightboxIndex((prev) => {
        if (prev === null) return null;
        const len = flatPhotos.length;
        return direction === "prev" ? (prev - 1 + len) % len : (prev + 1) % len;
      });
    },
    [flatPhotos.length],
  );

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") navigateLightbox("prev");
      else if (e.key === "ArrowRight") navigateLightbox("next");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, closeLightbox, navigateLightbox]);

  if (!isVisible) return null;

  const handleOpenJournal = (journalPath: string) => {
    const { tabs } = useEditorStore.getState();
    const existing = tabs.find((t) => t.filePath === journalPath);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
    } else {
      readFile(journalPath)
        .then((content) => {
          const fileName = journalPath.split("/").pop() ?? "Unknown";
          useFileStore.getState().setFileContent(journalPath, content);
          useEditorStore.getState().openTab({
            id: crypto.randomUUID(),
            filePath: journalPath,
            title: fileName,
            isDirty: false,
            isPinned: false,
          });
        })
        .catch(() => {});
    }
  };

  const formatGroupLabel = (key: string): string => {
    switch (groupMode) {
      case "day": {
        const d = new Date(key);
        return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
      }
      case "month": {
        const [y, m] = key.split("-");
        return `${y}년 ${parseInt(m)}월`;
      }
      case "year":
        return `${key}년`;
    }
  };

  const openLightbox = (photo: PhotoGalleryEntry) => {
    const idx = flatPhotos.indexOf(photo);
    setLightboxIndex(idx >= 0 ? idx : 0);
  };

  const lightboxPhoto = lightboxIndex !== null ? flatPhotos[lightboxIndex] : null;

  return (
    <div className="photo-gallery-panel">
      <div className="photo-gallery-header">
        <h3 className="photo-gallery-title">Photo Gallery</h3>
        <div className="photo-gallery-mode-toggle">
          {(["day", "month", "year"] as GroupMode[]).map((m) => (
            <button
              key={m}
              className={`photo-gallery-mode-btn ${groupMode === m ? "photo-gallery-mode-btn-active" : ""}`}
              onClick={() => setGroupMode(m)}
            >
              {m === "day" ? "Day" : m === "month" ? "Month" : "Year"}
            </button>
          ))}
        </div>
      </div>

      <div className="photo-gallery-content">
        {loading && <div className="photo-gallery-loading">Loading...</div>}

        {!loading && photos.length === 0 && (
          <div className="photo-gallery-empty">
            사진이 없습니다. 저널에 이미지를 드래그하거나 /photo로 추가하세요.
          </div>
        )}

        {sortedKeys.map((key) => {
          const groupPhotos = groups.get(key)!;
          return (
            <div key={key} className="photo-gallery-group">
              <div className="photo-gallery-group-header">
                <span>{formatGroupLabel(key)}</span>
                <span className="photo-gallery-group-count">{groupPhotos.length}</span>
              </div>
              <div className="photo-gallery-grid">
                {groupPhotos.map((photo, i) => (
                  <div
                    key={`${photo.filename}-${i}`}
                    className="photo-gallery-item"
                    onClick={() => openLightbox(photo)}
                    title={photo.caption || photo.filename}
                  >
                    <img
                      src={convertFileSrc(photo.absolutePath)}
                      alt={photo.caption || photo.filename}
                      className="photo-gallery-thumb"
                      loading="lazy"
                    />
                    {photo.caption && (
                      <span className="photo-gallery-item-caption">{photo.caption}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lightbox overlay */}
      {lightboxPhoto && (
        <div className="photo-lightbox-overlay" onClick={closeLightbox}>
          <div className="photo-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button className="photo-lightbox-close" onClick={closeLightbox}>✕</button>
            <button className="photo-lightbox-nav photo-lightbox-prev" onClick={() => navigateLightbox("prev")}>‹</button>
            <img
              src={convertFileSrc(lightboxPhoto.absolutePath)}
              alt={lightboxPhoto.caption || lightboxPhoto.filename}
              className="photo-lightbox-img"
            />
            <button className="photo-lightbox-nav photo-lightbox-next" onClick={() => navigateLightbox("next")}>›</button>
            <div className="photo-lightbox-info">
              <span className="photo-lightbox-caption">
                {lightboxPhoto.caption || lightboxPhoto.filename}
              </span>
              <span className="photo-lightbox-date">
                {lightboxPhoto.date.toLocaleDateString("ko-KR")}
              </span>
              {lightboxPhoto.journalPath && (
                <button
                  className="photo-lightbox-open-journal"
                  onClick={() => {
                    closeLightbox();
                    handleOpenJournal(lightboxPhoto.journalPath!);
                  }}
                >
                  일기 보기
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
