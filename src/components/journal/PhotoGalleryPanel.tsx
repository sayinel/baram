// §56d Photo Gallery — full gallery view panel
import { useCallback, useEffect, useMemo, useState } from "react";

import { useShallow } from "zustand/shallow";

import { INTL_LOCALES } from "../../i18n";
import { useTranslation } from "../../i18n/useTranslation";
import { readFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import {
  filterEntriesByMedia,
  groupPhotosByDate,
  type MediaFilter,
  type PhotoGalleryEntry,
  scanJournalPhotos,
} from "../../utils/journal/journal-photo";
import { basename } from "../../utils/path-utils";
import { PhotoGalleryThumb } from "./PhotoGalleryThumb";
import { PhotoLightbox } from "./PhotoLightbox";

type GroupMode = "day" | "month" | "year";

const GROUP_MODE_KEYS: Record<GroupMode, string> = {
  day: "journal.gallery.group.day",
  month: "journal.gallery.group.month",
  year: "journal.gallery.group.year",
};

const MEDIA_FILTER_KEYS: Record<MediaFilter, string> = {
  all: "journal.gallery.filter.all",
  photo: "journal.gallery.filter.photo",
  video: "journal.gallery.filter.video",
};

export function PhotoGalleryPanel() {
  const { locale, t } = useTranslation();
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
  // 세션 상태로 둔다. 설정에 영속시키면 "왜 사진이 안 보이지"가 앱을 다시 켜도 계속되는데,
  // 그 상태를 만든 클릭은 지난 세션의 것이라 사용자가 원인을 이어 붙일 방법이 없다.
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
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

  // Period label for the navigator.
  //
  // Built by Intl rather than by a format string: `${y}년 ${m}월` is not a translation
  // problem with a key-shaped answer — the year/month ORDER differs by locale, so a key
  // holding "{year} {month}" would still be wrong somewhere. Intl owns that ordering.
  const periodLabel = useMemo(() => {
    if (groupMode === "day") {
      return new Date(selectedYear, selectedMonth - 1).toLocaleDateString(
        INTL_LOCALES[locale],
        { year: "numeric", month: "long" },
      );
    } else if (groupMode === "month") {
      return new Date(selectedYear, 0).toLocaleDateString(
        INTL_LOCALES[locale],
        { year: "numeric" },
      );
    }
    return t("journal.gallery.period.all");
  }, [groupMode, selectedYear, selectedMonth, locale, t]);

  // ‼️ 거르기가 그룹 짓기 **앞**에 있어야 한다. 뒤에서 걸러도 그리드는 맞게 보이지만
  // 그룹 헤더의 개수와 `flatPhotos`(라이트박스의 좌우 이동)는 걸러지기 전 목록을 세게
  // 되어, 화면에 한 칸인데 헤더는 3이라 적고 오른쪽 화살표가 보이지도 않는 사진으로 넘어간다.
  const visibleEntries = useMemo(
    () => filterEntriesByMedia(photos, mediaFilter),
    [photos, mediaFilter],
  );

  const groups = useMemo(
    () => groupPhotosByDate(visibleEntries, groupMode),
    [visibleEntries, groupMode],
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
          const fileName = basename(journalPath);
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
    const intl = INTL_LOCALES[locale];
    switch (groupMode) {
      case "day": {
        const d = new Date(key);
        return d.toLocaleDateString(intl, {
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "short",
        });
      }
      case "month": {
        const [y, m] = key.split("-");
        return new Date(Number(y), Number(m) - 1).toLocaleDateString(intl, {
          year: "numeric",
          month: "long",
        });
      }
      case "year":
        return new Date(Number(key), 0).toLocaleDateString(intl, {
          year: "numeric",
        });
    }
  };

  const lightboxPhoto =
    lightboxIndex !== null ? flatPhotos[lightboxIndex] : null;

  // 빈 화면이 무엇 때문에 비었는지 말해야 한다. 사진이 세 장 있는데 필터가 동영상일 뿐인
  // 상태에서 "저널에 이미지를 드래그하세요"라고 안내하면 사용자를 엉뚱한 곳으로 보낸다.
  const emptyMessage =
    mediaFilter === "video"
      ? t("journal.gallery.empty.video")
      : mediaFilter === "photo"
        ? t("journal.gallery.empty.photo")
        : t("journal.gallery.empty.all");

  return (
    <div className="photo-gallery-panel">
      <div className="photo-gallery-header">
        <h3 className="photo-gallery-title">{t("journal.gallery.title")}</h3>
        <div className="photo-gallery-mode-toggle">
          {(["day", "month", "year"] as GroupMode[]).map((m) => (
            <button
              className={`photo-gallery-mode-btn ${groupMode === m ? "photo-gallery-mode-btn-active" : ""}`}
              key={m}
              onClick={() => setGroupMode(m)}
            >
              {t(GROUP_MODE_KEYS[m])}
            </button>
          ))}
        </div>
      </div>

      {/* 매체 토글은 자기 행에 둔다. 좁은 패널(~300px)에서 기간 토글 세 개와 매체 토글
          세 개를 한 줄에 넣으면 min-content 아래로 줄지 않는 flex 아이템 둘이 헤더를
          넘긴다 — 번역된 라벨은 영어보다 길어질 수 있으므로 폭 여유는 더 좁다. */}
      <div className="photo-gallery-media-row">
        <div className="photo-gallery-mode-toggle">
          {(["all", "photo", "video"] as MediaFilter[]).map((value) => (
            <button
              className={`photo-gallery-mode-btn ${mediaFilter === value ? "photo-gallery-mode-btn-active" : ""}`}
              key={value}
              onClick={() => setMediaFilter(value)}
            >
              {t(MEDIA_FILTER_KEYS[value])}
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
            {t("journal.loading")}
          </div>
        )}

        {!loading && visibleEntries.length === 0 && (
          <div className="photo-gallery-empty">{emptyMessage}</div>
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
