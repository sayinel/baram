// §56c Memories View — right panel component
import { useState } from "react";

import type { MemoryEntry } from "./OneLineEditor";

import { useShallow } from "zustand/shallow";

import { INTL_LOCALES } from "../../i18n";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { JournalTab } from "./JournalTab";
import { MiniCalendar } from "./MiniCalendar";

export function MemoriesPanel() {
  const { locale, t } = useTranslation();
  // ‼️ bare `useUIStore()` subscribes to the whole store, so any unrelated UI change re-renders
  // the panel and the memory cards under it.
  const { rightPanelMode, rightPanelOpen } = useUIStore(
    useShallow((s) => ({
      rightPanelMode: s.rightPanelMode,
      rightPanelOpen: s.rightPanelOpen,
    })),
  );
  const mode = useSettingsStore((s) => s.memoriesMode);
  const setMode = useSettingsStore((s) => s.setMemoriesMode);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showCalendar, setShowCalendar] = useState(false);

  if (!rightPanelOpen || rightPanelMode !== "memories") return null;

  const month = selectedDate.getMonth() + 1;
  const day = selectedDate.getDate();

  const isToday = (() => {
    const now = new Date();
    return (
      selectedDate.getFullYear() === now.getFullYear() &&
      selectedDate.getMonth() === now.getMonth() &&
      selectedDate.getDate() === now.getDate()
    );
  })();

  const navigateDay = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d);
  };

  return (
    <div className="memories-panel">
      <div className="memories-header flex-header">
        <span className="memories-header-title">
          {t("journal.memories.title")}
        </span>
        <div className="memories-date-nav">
          <button
            className="memories-date-nav-btn"
            onClick={() => navigateDay(-1)}
            title={t("journal.memories.prevDay")}
          >
            <svg
              fill="none"
              height="12"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
              width="12"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            className={`memories-date-nav-label ${showCalendar ? "memories-date-nav-label-active" : ""}`}
            onClick={() => setShowCalendar(!showCalendar)}
            title={t("journal.memories.openCalendar")}
          >
            {selectedDate.toLocaleDateString(INTL_LOCALES[locale], {
              month: "long",
              day: "numeric",
            })}
            {isToday && (
              <span className="memories-date-nav-today">
                {t("journal.today")}
              </span>
            )}
          </button>
          <button
            className="memories-date-nav-btn"
            onClick={() => navigateDay(1)}
            title={t("journal.memories.nextDay")}
          >
            <svg
              fill="none"
              height="12"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
              width="12"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      {showCalendar && (
        <MiniCalendar
          onClose={() => setShowCalendar(false)}
          onSelect={(d) => {
            setSelectedDate(d);
            setShowCalendar(false);
          }}
          selectedDate={selectedDate}
        />
      )}

      <div className="memories-content">
        <JournalTab
          day={day}
          loading={loading}
          memories={memories}
          mode={mode}
          month={month}
          setLoading={setLoading}
          setMemories={setMemories}
          setMode={setMode}
        />
      </div>
    </div>
  );
}
