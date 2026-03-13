// §4.6 Slash Menu — block insertion via /
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface SlashMenuItem {
  action: () => void;
  category: string;
  description: string;
  id: string;
  label: string;
  mdHint?: string;
}

export interface SlashMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashMenuProps {
  command: (item: SlashMenuItem) => void;
  items: SlashMenuItem[];
}

export const SlashMenuList = forwardRef<SlashMenuRef, SlashMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    // Scroll selected item into view
    useEffect(() => {
      const container = listRef.current;
      if (!container) return;
      const selected = container.querySelector(".slash-item-selected");
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
        if (event.key === "Enter") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return <div className="slash-menu-empty">No matching blocks</div>;
    }

    // Group by category
    const groups = new Map<
      string,
      { flatIdx: number; item: SlashMenuItem }[]
    >();
    items.forEach((item, idx) => {
      const list = groups.get(item.category) || [];
      list.push({ item, flatIdx: idx });
      groups.set(item.category, list);
    });

    return (
      <div className="slash-menu" ref={listRef}>
        {Array.from(groups.entries()).map(([category, entries]) => (
          <div className="slash-menu-group" key={category}>
            <div className="slash-menu-category">{category}</div>
            {entries.map(({ item, flatIdx }) => (
              <div
                className={`slash-menu-item ${flatIdx === selectedIndex ? "slash-item-selected" : ""}`}
                key={item.id}
                onClick={() => selectItem(flatIdx)}
                onMouseEnter={() => setSelectedIndex(flatIdx)}
              >
                <div className="slash-item-info">
                  <span className="slash-item-label">{item.label}</span>
                  <span className="slash-item-desc">{item.description}</span>
                </div>
                {item.mdHint && (
                  <span className="slash-item-hint">{item.mdHint}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  },
);

SlashMenuList.displayName = "SlashMenuList";
