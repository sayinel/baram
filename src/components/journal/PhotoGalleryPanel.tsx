// §56d Photo Gallery — full gallery view panel
import { useCallback, useEffect, useMemo, useState } from "react";

import { useShallow } from "zustand/shallow";

import { readFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import {
  groupPhotosByDate,
  type PhotoGalleryEntry,
  scanJournalPhotos,
} from "../../utils/journal/journal-photo";
import { PhotoGalleryThumb } from "./PhotoGalleryThumb";
import { PhotoLightbox } from "./PhotoLightbox";

type GroupMode = "day" | "month" | "year";

export function PhotoGalleryPanel() {
  // ‼️ bare `useUIStore()`가 아니어야 한다. 그 형태는 스토어 전체를 구독하므로 무관한 UI
  // 변화 하나하나가 사진 수백 칸을 다시 렌더한다 — 저널을 열면 파일 스토어가 바뀌므로
  // 정확히 그 순간에 걸린다.
  const { rightPanelMode, rightPanelOpen } = useUIStore(
    useShallow((s) => ({
      rightPanelMode: s.rightPanelMode,
      rightPanelOpen: s.rightPanelOpen,
    })),
  );
  const rootPath = useFileStore((s) => s.rootPath);
  const journalDirectory = useSettingsStore((s) => s.journalDirectory);

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

  // ‼️ useCallback이어야 한다 — 매 렌더 새 함수를 넘기면 칸마다 걸어 둔 `memo`가 전부
  // 무효가 되어 사진 수백 개가 같이 다시 렌더된다.
  const openLightbox = useCallback(
    (photo: PhotoGalleryEntry) => {
      const idx = flatPhotos.indexOf(photo);
      setLightboxIndex(idx >= 0 ? idx : 0);
    },
    [flatPhotos],
  );

  // ‼️ 라이트박스의 키보드(Esc·좌우)는 PhotoLightbox가 가진다 — 여기 있으면 원본 보기가
  // 열렸을 때 Esc 한 번에 두 레이어가 같이 닫힌다(그쪽 effect의 주석 참조).

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
            contextId: "",
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
        {loading && (
          <div aria-live="polite" className="photo-gallery-loading">
            Loading…
          </div>
        )}

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
                {groupPhotos.map((photo) => (
                  // key가 absolutePath인 이유: 파일마다 유일하고, 기간을 옮길 때 같은
                  // 자리의 다른 사진이 이전 사진의 썸네일 상태를 물려받지 않는다.
                  <PhotoGalleryThumb
                    key={photo.absolutePath}
                    onOpen={openLightbox}
                    photo={photo}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {lightboxPhoto && (
        <PhotoLightbox
          onClose={closeLightbox}
          onNavigate={navigateLightbox}
          onOpenJournal={handleOpenJournal}
          photo={lightboxPhoto}
        />
      )}
    </div>
  );
}
