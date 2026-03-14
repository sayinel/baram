// §56c MiniCalendar — date picker calendar for MemoriesPanel
import { useEffect, useRef, useState } from "react";

import { getFirstDayOfWeek, getMonthDays } from "../../utils/journal/journal";

const MINI_CAL_DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const MINI_CAL_MONTH_NAMES = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
];

export interface MiniCalendarProps {
  onClose: () => void;
  onSelect: (date: Date) => void;
  selectedDate: Date;
}

type CalendarView = "days" | "months" | "years";

export function MiniCalendar({
  selectedDate,
  onSelect,
  onClose,
}: MiniCalendarProps) {
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());
  const [view, setView] = useState<CalendarView>("days");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const days = getMonthDays(viewYear, viewMonth);
  const firstDow = getFirstDayOfWeek(viewYear, viewMonth);
  const today = new Date();

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  // Years view: 12-year range centered on current viewYear
  const yearRangeStart = viewYear - (viewYear % 12);
  const yearRange = Array.from({ length: 12 }, (_, i) => yearRangeStart + i);

  const navPrev = () => {
    if (view === "days") {
      if (viewMonth === 0) {
        setViewYear(viewYear - 1);
        setViewMonth(11);
      } else setViewMonth(viewMonth - 1);
    } else if (view === "months") {
      setViewYear(viewYear - 1);
    } else {
      setViewYear(yearRangeStart - 12);
    }
  };

  const navNext = () => {
    if (view === "days") {
      if (viewMonth === 11) {
        setViewYear(viewYear + 1);
        setViewMonth(0);
      } else setViewMonth(viewMonth + 1);
    } else if (view === "months") {
      setViewYear(viewYear + 1);
    } else {
      setViewYear(yearRangeStart + 12);
    }
  };

  const headerLabel =
    view === "days" ? (
      <>
        <button
          className="memories-mini-calendar-title-btn"
          onClick={() => setView("months")}
        >
          {MINI_CAL_MONTH_NAMES[viewMonth]}
        </button>{" "}
        <button
          className="memories-mini-calendar-title-btn"
          onClick={() => setView("years")}
        >
          {viewYear}
        </button>
      </>
    ) : view === "months" ? (
      <button
        className="memories-mini-calendar-title-btn"
        onClick={() => setView("years")}
      >
        {viewYear}년
      </button>
    ) : (
      <span className="memories-mini-calendar-title-text">
        {yearRangeStart}–{yearRangeStart + 11}
      </span>
    );

  return (
    <div className="memories-mini-calendar" ref={ref}>
      <div className="memories-mini-calendar-header">
        <button className="memories-mini-calendar-nav" onClick={navPrev}>
          ‹
        </button>
        <span className="memories-mini-calendar-title">{headerLabel}</span>
        <button className="memories-mini-calendar-nav" onClick={navNext}>
          ›
        </button>
      </div>

      {view === "days" && (
        <div className="memories-mini-calendar-grid">
          {MINI_CAL_DAY_NAMES.map((d) => (
            <div className="memories-mini-calendar-dow" key={d}>
              {d}
            </div>
          ))}
          {Array.from({ length: firstDow }).map((_, i) => (
            <div className="memories-mini-calendar-pad" key={`pad-${i}`} />
          ))}
          {days.map((d) => {
            const isSelected = isSameDay(d, selectedDate);
            const isToday = isSameDay(d, today);
            return (
              <button
                className={[
                  "memories-mini-calendar-day",
                  isSelected ? "memories-mini-calendar-day-selected" : "",
                  isToday ? "memories-mini-calendar-day-today" : "",
                ].join(" ")}
                key={d.getDate()}
                onClick={() => onSelect(d)}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      )}

      {view === "months" && (
        <div className="memories-mini-calendar-picker">
          {MINI_CAL_MONTH_NAMES.map((name, i) => (
            <button
              className={`memories-mini-calendar-pick-btn ${i === viewMonth && viewYear === selectedDate.getFullYear() ? "memories-mini-calendar-pick-btn-selected" : ""} ${i === today.getMonth() && viewYear === today.getFullYear() ? "memories-mini-calendar-pick-btn-today" : ""}`}
              key={i}
              onClick={() => {
                setViewMonth(i);
                setView("days");
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {view === "years" && (
        <div className="memories-mini-calendar-picker">
          {yearRange.map((y) => (
            <button
              className={`memories-mini-calendar-pick-btn ${y === selectedDate.getFullYear() ? "memories-mini-calendar-pick-btn-selected" : ""} ${y === today.getFullYear() ? "memories-mini-calendar-pick-btn-today" : ""}`}
              key={y}
              onClick={() => {
                setViewYear(y);
                setView("months");
              }}
            >
              {y}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
