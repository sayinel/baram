// §56l — Tag autocomplete dropdown for journal captures
import { useEffect, useRef } from "react";

import type { TagSuggestion } from "./use-capture-tags";

import { useTranslation } from "../../i18n/useTranslation";

interface TagSuggestProps {
  activeIndex: number;
  onSelect: (tag: string) => void;
  position?: { left: number; top: number };
  /** ‼️ 여기서 다시 필터링하지 않는다 — `useCaptureTags`가 한 번만 계산한 것을
   *  그대로 그린다. 여기서 또 계산하면 키보드가 고르는 것과 화면에 보이는 것이
   *  서로 다른 출처가 될 수 있다(§324-b 후속 규칙 ①). */
  suggestions: TagSuggestion[];
  visible: boolean;
}

export function TagSuggest({
  suggestions,
  onSelect,
  visible,
  activeIndex,
  position,
}: TagSuggestProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items =
      listRef.current.querySelectorAll<HTMLLIElement>(".tag-suggest-item");
    items[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!visible || suggestions.length === 0) return null;

  const style: React.CSSProperties = position
    ? { top: position.top, left: position.left }
    : {};

  return (
    <ul
      aria-label={t("journal.tagSuggest.aria")}
      className="tag-suggest"
      role="listbox"
      style={style}
    >
      {suggestions.map((s, i) => (
        <li
          aria-selected={i === activeIndex}
          className={`tag-suggest-item ${i === activeIndex ? "tag-suggest-item-active" : ""}`}
          key={s.name}
          onMouseDown={(e) => {
            // Prevent input blur before selection
            e.preventDefault();
            onSelect(s.name);
          }}
          role="option"
        >
          <span className="tag-suggest-name">#{s.name}</span>
          {/* ‼️ 리뷰 MEDIUM — 노트 라벨은 숫자 배지(`tag-suggest-count`)를
              재사용하지 않는다. 그 배지는 `panels.css`에서 짧은 숫자 하나를
              가정한 원형 pill(`min-width: 20px`, `border-radius: 10px`,
              가운데 정렬)이라 문구를 넣으면 그 안에서 줄바꿈된다. 태그 행은
              그대로 숫자 pill을, 노트 행은 별도 클래스를 쓴다. */}
          {s.isNote ? (
            <span className="tag-suggest-kind">
              {s.count > 0
                ? t("journal.tagSuggest.noteWithCount", {
                    count: String(s.count),
                  })
                : t("journal.tagSuggest.note")}
            </span>
          ) : (
            <span className="tag-suggest-count">{s.count}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
