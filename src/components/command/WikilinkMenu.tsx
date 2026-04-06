// §31 Wikilink autocomplete menu — file suggestion popup
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import type { WikilinkSuggestionItem } from "../../extensions/plugins/wikilink-suggest-utils";

export interface WikilinkMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface WikilinkMenuProps {
  command: (item: WikilinkSuggestionItem) => void;
  items: WikilinkSuggestionItem[];
}

export const WikilinkMenuList = forwardRef<WikilinkMenuRef, WikilinkMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    // §87 Separate selectable items from hint items
    const selectableItems = useMemo(
      () => items.filter((i) => i.kind !== "hint"),
      [items],
    );

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
        const item = selectableItems[index];
        if (item) command(item);
      },
      [selectableItems, command],
    );

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (selectableItems.length === 0) return false;
        if (event.key === "ArrowUp") {
          setSelectedIndex(
            (i) => (i - 1 + selectableItems.length) % selectableItems.length,
          );
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % selectableItems.length);
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
        {items.map((item) => {
          if (item.kind === "hint") {
            return (
              <div className="wikilink-menu-hint" key={item.id}>
                <span className="wikilink-hint-label">{item.label}</span>
              </div>
            );
          }
          const selectableIdx = selectableItems.indexOf(item);
          return (
            <div
              className={`wikilink-menu-item ${selectableIdx === selectedIndex ? "wikilink-item-selected" : ""}${item.kind === "create" ? "wikilink-item-create" : ""}`}
              key={item.id}
              onClick={() => selectItem(selectableIdx)}
              onMouseEnter={() => setSelectedIndex(selectableIdx)}
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
          );
        })}
      </div>
    );
  },
);

WikilinkMenuList.displayName = "WikilinkMenuList";
