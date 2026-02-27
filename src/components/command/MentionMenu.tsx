// §57 Mention autocomplete menu — date/page suggestion popup
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import type { MentionSuggestionItem } from "../../extensions/plugins/mention-suggest";

export interface MentionMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface MentionMenuProps {
  items: MentionSuggestionItem[];
  command: (item: MentionSuggestionItem) => void;
}

export const MentionMenuList = forwardRef<MentionMenuRef, MentionMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      const container = listRef.current;
      if (!container) return;
      const selected = container.querySelector(".mention-item-selected");
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
      return <div className="mention-menu-empty">No matches</div>;
    }

    // Group items by category
    const dateItems = items.filter((i) => i.category === "date");
    const pageItems = items.filter((i) => i.category === "page");

    let globalIdx = 0;

    return (
      <div className="mention-menu" ref={listRef}>
        {dateItems.length > 0 && (
          <>
            <div className="mention-menu-category">Dates</div>
            {dateItems.map((item) => {
              const idx = globalIdx++;
              return (
                <div
                  key={item.id}
                  className={`mention-menu-item mention-menu-item-date${idx === selectedIndex ? " mention-item-selected" : ""}`}
                  onClick={() => selectItem(idx)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <span className="mention-item-icon">{"\uD83D\uDCC5"}</span>
                  <span className="mention-item-label">{item.label}</span>
                </div>
              );
            })}
          </>
        )}
        {pageItems.length > 0 && (
          <>
            <div className="mention-menu-category">Pages</div>
            {pageItems.map((item) => {
              const idx = globalIdx++;
              return (
                <div
                  key={item.id}
                  className={`mention-menu-item mention-menu-item-page${idx === selectedIndex ? " mention-item-selected" : ""}`}
                  onClick={() => selectItem(idx)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <span className="mention-item-icon">{"\uD83D\uDCC4"}</span>
                  <span className="mention-item-label">{item.label}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  },
);

MentionMenuList.displayName = "MentionMenuList";
