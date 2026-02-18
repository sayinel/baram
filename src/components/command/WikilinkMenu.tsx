// §31 Wikilink autocomplete menu — file suggestion popup
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import type { WikilinkSuggestionItem } from "../../extensions/plugins/wikilink-suggest-utils";

export interface WikilinkMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface WikilinkMenuProps {
  items: WikilinkSuggestionItem[];
  command: (item: WikilinkSuggestionItem) => void;
}

export const WikilinkMenuList = forwardRef<WikilinkMenuRef, WikilinkMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      const container = listRef.current;
      if (!container) return;
      const selected = container.querySelector(".wikilink-item-selected");
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
      return <div className="wikilink-menu-empty">No matching pages</div>;
    }

    return (
      <div className="wikilink-menu" ref={listRef}>
        {items.map((item, idx) => (
          <div
            key={item.id}
            className={`wikilink-menu-item ${idx === selectedIndex ? "wikilink-item-selected" : ""}${item.kind === "create" ? " wikilink-item-create" : ""}`}
            onClick={() => selectItem(idx)}
            onMouseEnter={() => setSelectedIndex(idx)}
          >
            {item.kind === "create" ? (
              <>
                <span className="wikilink-item-icon">+</span>
                <span className="wikilink-item-label">{item.label}</span>
              </>
            ) : item.kind === "heading" ? (
              <>
                <span className="wikilink-heading-icon">
                  {"#".repeat(item.headingLevel ?? 1)}
                </span>
                <span className="wikilink-item-label">{item.heading}</span>
              </>
            ) : (
              <span className="wikilink-item-label">{item.target}</span>
            )}
          </div>
        ))}
      </div>
    );
  },
);

WikilinkMenuList.displayName = "WikilinkMenuList";
