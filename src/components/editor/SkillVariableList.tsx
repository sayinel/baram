// §72c Skill variable autocomplete menu — {{variable}} suggestion popup
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface SkillVariableItem {
  description: string;
  name: string;
}

export interface SkillVariableListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SkillVariableListProps {
  command: (item: SkillVariableItem) => void;
  items: SkillVariableItem[];
}

export const SkillVariableList = forwardRef<
  SkillVariableListRef,
  SkillVariableListProps
>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const selected = container.querySelector(".skill-var-item--selected");
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
    <div className="skill-var-list" ref={listRef}>
      {items.map((item, idx) => (
        <div
          className={`skill-var-item ${idx === selectedIndex ? "skill-var-item--selected" : ""}`}
          key={item.name}
          onClick={() => selectItem(idx)}
          onMouseEnter={() => setSelectedIndex(idx)}
        >
          <span className="skill-var-name">{`{{${item.name}}}`}</span>
          <span className="skill-var-desc">{item.description}</span>
        </div>
      ))}
    </div>
  );
});

SkillVariableList.displayName = "SkillVariableList";
