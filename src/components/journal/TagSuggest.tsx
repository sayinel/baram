// §56l — Tag autocomplete dropdown for journal captures
import { useEffect, useRef } from "react";

import { filterTags } from "../../utils/journal-tags";

interface TagSuggestProps {
  activeIndex: number;
  onSelect: (tag: string) => void;
  position?: { left: number; top: number };
  query: string;
  tags: Map<string, number>;
  visible: boolean;
}

export function TagSuggest({
  query,
  tags,
  onSelect,
  visible,
  activeIndex,
  position,
}: TagSuggestProps) {
  const listRef = useRef<HTMLUListElement>(null);

  const suggestions = filterTags(query, tags);

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
      aria-label="Tag suggestions"
      className="tag-suggest"
      role="listbox"
      style={style}
    >
      {suggestions.map((tag, i) => (
        <li
          aria-selected={i === activeIndex}
          className={`tag-suggest-item${i === activeIndex ? "tag-suggest-item-active" : ""}`}
          key={tag}
          onMouseDown={(e) => {
            // Prevent input blur before selection
            e.preventDefault();
            onSelect(tag);
          }}
          role="option"
        >
          <span className="tag-suggest-name">#{tag}</span>
          <span className="tag-suggest-count">{tags.get(tag) ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}
