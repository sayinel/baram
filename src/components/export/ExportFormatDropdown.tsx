// §5.12 Export — category-grouped format dropdown (replaces flat card list)
import { useEffect, useRef, useState } from "react";

import type { ExportFormat } from "../../stores/ui/ui";

export interface ExportFormatGroup {
  label: string;
  options: ExportFormatOption[];
}

export interface ExportFormatOption {
  desc: string;
  ext: string;
  id: ExportFormat;
  name: string;
  pandoc: boolean;
}

interface Props {
  groups: ExportFormatGroup[];
  onChange: (id: ExportFormat) => void;
  pandocAvailable: boolean;
  value: ExportFormat;
}

export function ExportFormatDropdown({
  groups,
  value,
  pandocAvailable,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = groups.flatMap((g) => g.options).find((o) => o.id === value);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <div className="export-format-dropdown" ref={rootRef}>
      <button
        aria-haspopup="listbox"
        className="export-format-trigger"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {current && <span className="export-ext-badge">{current.ext}</span>}
        <span className="export-format-trigger-name">
          {current ? current.name : "Select format"}
        </span>
        <span className="export-format-trigger-caret">▾</span>
      </button>

      {open && (
        <div className="export-format-popup" role="listbox">
          {groups.map((group) => (
            <div className="export-format-group" key={group.label}>
              <div className="export-format-group-label">{group.label}</div>
              {group.options.map((opt) => {
                const disabled = opt.pandoc && !pandocAvailable;
                return (
                  <button
                    aria-selected={opt.id === value}
                    className={`export-format-item ${
                      opt.id === value ? "export-format-item-selected" : ""
                    } ${disabled ? "export-format-item-disabled" : ""}`}
                    disabled={disabled}
                    key={opt.id}
                    onClick={() => {
                      if (disabled) return;
                      onChange(opt.id);
                      setOpen(false);
                    }}
                    role="option"
                    type="button"
                  >
                    <span className="export-ext-badge">{opt.ext}</span>
                    <span className="export-format-item-info">
                      <span className="export-format-item-name">
                        {opt.name}
                      </span>
                      <span className="export-format-item-desc">
                        {opt.desc}
                      </span>
                    </span>
                    {opt.pandoc && (
                      <span className="export-pandoc-badge">pandoc</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
