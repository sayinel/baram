// §375 `:` symbol & emoji autocomplete menu.
//
// `items` is never empty while this is mounted: `shouldShow` in
// symbol-suggest.ts keeps the suggestion inactive when a query has no
// candidates, so there is no empty state to draw.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type { SymbolSuggestionItem } from "../../extensions/plugins/symbol-search";

export interface SymbolMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SymbolMenuProps {
  command: (item: SymbolSuggestionItem) => void;
  items: SymbolSuggestionItem[];
}

export const SymbolMenuList = forwardRef<SymbolMenuRef, SymbolMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      listRef.current
        ?.querySelector(".symbol-menu-item-selected")
        ?.scrollIntoView({ block: "nearest" });
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
        if (items.length === 0) return false;
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

    return (
      <div className="symbol-menu" ref={listRef} role="listbox">
        {items.map((item, idx) => (
          <div
            aria-selected={idx === selectedIndex}
            className={`symbol-menu-item ${idx === selectedIndex ? "symbol-menu-item-selected" : ""}`}
            key={item.id}
            onClick={() => selectItem(idx)}
            onMouseEnter={() => setSelectedIndex(idx)}
            role="option"
          >
            <span className="symbol-menu-char">{item.char}</span>
            <span className="symbol-menu-label">{item.label}</span>
          </div>
        ))}
      </div>
    );
  },
);

SymbolMenuList.displayName = "SymbolMenuList";
