// §56l Tag autocomplete menu — inline #tag suggestion popup
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";

export interface TagSuggestionItem {
  id: string;
  tag: string;
  count: number;
}

export interface TagMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface TagMenuProps {
  items: TagSuggestionItem[];
  command: (item: TagSuggestionItem) => void;
}

export const TagMenuList = forwardRef<TagMenuRef, TagMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      const container = listRef.current;
      if (!container) return;
      const selected = container.querySelector(".tag-menu-item-selected");
      if (selected) {
        selected.scrollIntoView({ block: "nearest" });
      }
    }, [selectedIndex]);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) command(item);
      },
      [items, command],
    );

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return null;
    }

    return (
      <div className="tag-menu" ref={listRef}>
        {items.map((item, idx) => (
          <div
            key={item.id}
            className={`tag-menu-item ${idx === selectedIndex ? "tag-menu-item-selected" : ""}`}
            onClick={() => selectItem(idx)}
            onMouseEnter={() => setSelectedIndex(idx)}
          >
            <span className="tag-menu-name">#{item.tag}</span>
            <span className="tag-menu-count">{item.count}</span>
          </div>
        ))}
      </div>
    );
  },
);

TagMenuList.displayName = "TagMenuList";
