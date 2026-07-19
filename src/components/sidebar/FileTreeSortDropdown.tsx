// §4.5 File tree — sort order dropdown (folder-first fixed, key selectable)
import { useEffect, useRef, useState } from "react";

import type { SortOrder } from "../../stores/file/file-tree-sort";

import { IconSort } from "./file-tree-icons";

const OPTIONS: { label: string; value: SortOrder }[] = [
  { label: "Name (A–Z)", value: "name-asc" },
  { label: "Name (Z–A)", value: "name-desc" },
  { label: "Modified (newest)", value: "mtime-desc" },
  { label: "Modified (oldest)", value: "mtime-asc" },
];

export function FileTreeSortDropdown({
  onChange,
  value,
}: {
  onChange: (order: SortOrder) => void;
  value: SortOrder;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="file-tree-sort" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="file-tree-action-btn"
        onClick={() => setOpen((o) => !o)}
        title="Sort files"
        type="button"
      >
        <IconSort />
      </button>
      {open && (
        <ul className="file-tree-sort-menu" role="listbox">
          {OPTIONS.map((opt) => (
            <li
              aria-selected={opt.value === value}
              className={`file-tree-sort-option ${
                opt.value === value ? "file-tree-sort-option-active" : ""
              }`}
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              role="option"
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
