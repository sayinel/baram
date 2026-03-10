// §56d Photo Gallery — full gallery view panel
import { useCallback, useEffect, useMemo, useState } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

import { readFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useUIStore } from "../../stores/ui-store";
import {
  groupPhotosByDate,
  type PhotoGalleryEntry,
  scanJournalPhotos,
} from "../../utils/journal-photo";

type GroupMode = "day" | "month" | "year";

export function PhotoGalleryPanel() {
  const { rightPanelOpen, rightPanelMode } = useUIStore();
  const { rootPath } = useFileStore();
  const { journalDirectory } = useSettingsStore();

  const [photos, setPhotos] = useState<PhotoGalleryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>("day");
  const [lightboxIndex, setLightboxIndex] = useState<null | number>(null);

  // Date navigation state
  const now = useMemo(() => new Date(), []);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  const isVisible = rightPanelOpen && rightPanelMode === "photo-gallery";

  const loadPhotos = useCallback(async () => {
    if (!rootPath || !journalDirectory) return;
    setLoading(true);
    try {
      const options =
        groupMode === "year"
          ? undefined // year mode: load all
          : groupMode === "month"
            ? { year: selectedYear } // month mode: filter by year
            : { year: selectedYear, month: selectedMonth }; // day mode: filter by year+month
      const result = await scanJournalPhotos(
        rootPath,
        journalDirectory,
        options,
      );
      setPhotos(result);
    } catch {
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [rootPath, journalDirectory, groupMode, selectedYear, selectedMonth]);

  useEffect(() => {
    if (!isVisible) return;
    loadPhotos();
  }, [isVisible, loadPhotos]);

  // Navigate to previous/next period
  const navigatePeriod = useCallback(
    (direction: -1 | 1) => {
      if (groupMode === "day") {
        // Navigate by month
        let newMonth = selectedMonth + direction;
        let newYear = selectedYear;
        if (newMonth < 1) {
          newMonth = 12;
          newYear--;
        } else if (newMonth > 12) {
          newMonth = 1;
          newYear++;
        }
        setSelectedMonth(newMonth);
        setSelectedYear(newYear);
      } else if (groupMode === "month") {
        // Navigate by year
        setSelectedYear((y) => y + direction);
      }
      // year mode: no navigation needed
    },
    [groupMode, selectedMonth, selectedYear],
  );

  // Period label for the navigator
  const periodLabel = useMemo(() => {
    if (groupMode === "day") {
      return `${selectedYear}년 ${selectedMonth}월`;
    } else if (groupMode === "month") {
      return `${selectedYear}년`;
    }
    return "전체";
  }, [groupMode, selectedYear, selectedMonth]);

  const groups = useMemo(
    () => groupPhotosByDate(photos, groupMode),
    [photos, groupMode],
  );

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
    (direction: "next" | "prev") => {
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
        return d.toLocaleDateString("ko-KR", {
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "short",
        });
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

  const lightboxPhoto =
    lightboxIndex !== null ? flatPhotos[lightboxIndex] : null;

  return (
    <div className="photo-gallery-panel">
      <div className="photo-gallery-header">
        <h3 className="photo-gallery-title">Photo Gallery</h3>
        <div className="photo-gallery-mode-toggle">
          {(["day", "month", "year"] as GroupMode[]).map((m) => (
            <button
              className={`photo-gallery-mode-btn ${groupMode === m ? "photo-gallery-mode-btn-active" : ""}`}
              key={m}
              onClick={() => setGroupMode(m)}
            >
              {m === "day" ? "Day" : m === "month" ? "Month" : "Year"}
            </button>
          ))}
        </div>
      </div>

      {/* Date navigator — Day: month picker, Month: year picker, Year: no nav */}
      {groupMode !== "year" && (
        <div className="photo-gallery-nav">
          <button
            className="photo-gallery-nav-btn"
            onClick={() => navigatePeriod(-1)}
          >
            ‹
          </button>
          <span className="photo-gallery-nav-label">{periodLabel}</span>
          <button
            className="photo-gallery-nav-btn"
            onClick={() => navigatePeriod(1)}
          >
            ›
          </button>
        </div>
      )}

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
            <div className="photo-gallery-group" key={key}>
              <div className="photo-gallery-group-header">
                <span>{formatGroupLabel(key)}</span>
                <span className="photo-gallery-group-count">
                  {groupPhotos.length}
                </span>
              </div>
              <div className="photo-gallery-grid">
                {groupPhotos.map((photo, i) => (
                  <div
                    className="photo-gallery-item"
                    key={`${photo.filename}-${i}`}
                    onClick={() => openLightbox(photo)}
                    title={photo.caption || photo.filename}
                  >
                    <img
                      alt={photo.caption || photo.filename}
                      className="photo-gallery-thumb"
                      loading="lazy"
                      src={convertFileSrc(photo.absolutePath)}
                    />
                    {photo.caption && (
                      <span className="photo-gallery-item-caption">
                        {photo.caption}
                      </span>
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
          {/* Nav buttons fixed to overlay edges */}
          <button
            className="photo-lightbox-nav photo-lightbox-prev"
            onClick={(e) => {
              e.stopPropagation();
              navigateLightbox("prev");
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
              navigateLightbox("next");
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
              closeLightbox();
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
            <img
              alt={lightboxPhoto.caption || lightboxPhoto.filename}
              className="photo-lightbox-img"
              src={convertFileSrc(lightboxPhoto.absolutePath)}
            />
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
