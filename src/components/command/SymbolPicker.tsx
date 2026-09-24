// §377 The symbol & emoji picker behind the slash menu's "Symbols & Emoji".
//
// For the symbol whose name you do not know; the `:` autocomplete (§375) is
// for the one you do. Searching here calls that autocomplete's
// `searchSymbols`, so both find the same things in the same order. Focus stays
// in the search box for the picker's whole life — one mousedown handler on
// the root prevents default for every target except the search input itself,
// so cells, tabs, section titles, the footer and the gaps between them all
// leave focus alone — every key still arrives at the one handler on the root.
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { SymbolSectionId } from "../../extensions/plugins/symbol-sections";
import type { LucideIcon } from "lucide-react";

import {
  Apple,
  Clock,
  Flag,
  Hand,
  Heart,
  Lightbulb,
  PawPrint,
  Plane,
  Sigma,
  Smile,
  Volleyball,
} from "lucide-react";

import {
  ensureEmojiLoaded,
  loadedEmoji,
} from "../../extensions/plugins/emoji-data";
import { searchSymbols } from "../../extensions/plugins/symbol-search";
import { buildSymbolSections } from "../../extensions/plugins/symbol-sections";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import { Tooltip } from "../Tooltip";
import {
  clampPosition,
  type GridPosition,
  type GridRow,
  isGridArrow,
  moveInGrid,
  toGridRows,
} from "./symbol-grid-nav";

/** Search results the grid shows — twelve rows. */
const RESULT_LIMIT = 96;

const ORIGIN: GridPosition = { col: 0, row: 0 };

/** The strip above the grid; each tab jumps to a section. `label` is an i18n key. */
const TABS: readonly {
  icon: LucideIcon;
  label: string;
  target: SymbolSectionId;
}[] = [
  { icon: Clock, label: "symbolPicker.section.recent", target: "recent" },
  { icon: Sigma, label: "symbolPicker.tab.symbols", target: "arrows" },
  { icon: Smile, label: "symbolPicker.section.smileys", target: "smileys" },
  { icon: Hand, label: "symbolPicker.section.people", target: "people" },
  { icon: PawPrint, label: "symbolPicker.section.animals", target: "animals" },
  { icon: Apple, label: "symbolPicker.section.food", target: "food" },
  { icon: Plane, label: "symbolPicker.section.travel", target: "travel" },
  {
    icon: Volleyball,
    label: "symbolPicker.section.activities",
    target: "activities",
  },
  { icon: Lightbulb, label: "symbolPicker.section.objects", target: "objects" },
  {
    icon: Heart,
    label: "symbolPicker.section.emojiSymbols",
    target: "emojiSymbols",
  },
  { icon: Flag, label: "symbolPicker.section.flags", target: "flags" },
];

interface SymbolPickerProps {
  onCancel: () => void;
  onPick: (char: string) => void;
}

export function SymbolPicker({ onCancel, onPick }: SymbolPickerProps) {
  const { locale, t } = useTranslation();
  const recent = useSettingsStore((s) => s.recentSymbols);
  const [emoji, setEmoji] = useState(loadedEmoji);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(ORIGIN);
  const gridRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The first open in a session fetches the emoji chunk and shows it when it
  // lands. A failed load leaves `emoji` null (emoji-data.ts logs it); the
  // recent and symbol sections still work.
  useEffect(() => {
    if (emoji !== null) return;
    let mounted = true;
    void ensureEmojiLoaded().then(() => {
      if (mounted) setEmoji(loadedEmoji());
    });
    return () => {
      mounted = false;
    };
  }, [emoji]);

  const trimmed = query.trim();
  const searching = trimmed !== "";
  const rows = useMemo(
    () =>
      toGridRows(
        searching
          ? [
              {
                id: "results",
                items: searchSymbols(trimmed, emoji, locale, RESULT_LIMIT),
              },
            ]
          : buildSymbolSections(recent, emoji, locale),
      ),
    [emoji, locale, recent, searching, trimmed],
  );
  const selected = clampPosition(rows, position);
  const selectedItem = selected
    ? rows[selected.row].items[selected.col]
    : undefined;
  const selectedRow = selected?.row ?? -1;
  const selectedCol = selected?.col ?? -1;

  useEffect(() => {
    gridRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [rows, selectedCol, selectedRow]);

  const hover = useCallback((row: number, col: number) => {
    setPosition({ col, row });
  }, []);

  const jumpTo = (target: SymbolSectionId): void => {
    const row = rows.findIndex((r) => r.sectionId === target);
    if (row === -1) return;
    gridRef.current
      ?.querySelector(`[data-section="${target}"]`)
      ?.scrollIntoView({ block: "start" });
    setPosition({ col: 0, row });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (isComposing(event)) return;
    const { key } = event;
    // An arrow with a modifier is the search box's: not default-prevented, so
    // the input's own action runs (Shift+arrow extends its text selection, for
    // one), and not a grid move — only a plain arrow moves the grid. It is
    // still stopped, so listeners further up the page do not act on it too:
    // use-global-keyboard.ts's window listener navigates back/forward on Alt+←/→
    // on Windows/Linux.
    if (isGridArrow(key) && hasModifier(event)) {
      event.stopPropagation();
      return;
    }
    if (
      key !== "Enter" &&
      key !== "Escape" &&
      key !== "Tab" &&
      !isGridArrow(key)
    )
      return;
    // A key the picker uses stops here, so listeners further up the page do
    // not act on it too.
    event.preventDefault();
    event.stopPropagation();
    if (key === "Escape") onCancel();
    else if (key === "Enter") {
      if (selectedItem) onPick(selectedItem.char);
    } else if (isGridArrow(key) && selected) {
      setPosition(moveInGrid(rows, selected, key));
    }
    // Tab does nothing: focus stays in the search box.
  };

  // The only target a mousedown may focus is the search input itself —
  // everywhere else in the dialog (cells, tabs, section titles, the footer,
  // the gaps between them) default-prevents so focus never leaves it.
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target !== searchRef.current) event.preventDefault();
  };

  return (
    <div
      aria-label={t("symbolPicker.title")}
      className="symbol-picker"
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      role="dialog"
    >
      <input
        aria-label={t("symbolPicker.search")}
        autoFocus
        className="symbol-picker-search"
        onChange={(event) => {
          setQuery(event.target.value);
          setPosition(ORIGIN);
        }}
        placeholder={t("symbolPicker.search")}
        ref={searchRef}
        spellCheck={false}
        type="text"
        value={query}
      />
      <div className="symbol-picker-tabs" role="toolbar">
        {TABS.map(({ icon: Icon, label, target }) => {
          const tabDisabled =
            searching || !rows.some((r) => r.sectionId === target);
          return (
            <Tooltip key={target} label={t(label)} placement="bottom">
              <button
                aria-disabled={tabDisabled}
                className="symbol-picker-tab btn-unstyled"
                onClick={() => {
                  if (!tabDisabled) jumpTo(target);
                }}
                tabIndex={-1}
                type="button"
              >
                <Icon size={14} />
              </button>
            </Tooltip>
          );
        })}
      </div>
      <div className="symbol-picker-grid" ref={gridRef} role="listbox">
        {rows.length === 0 ? (
          <div className="symbol-picker-empty">{t("symbolPicker.empty")}</div>
        ) : (
          rows.map((row, index) => (
            <Fragment key={`${row.sectionId}:${index}`}>
              {row.sectionId !== "results" &&
                (index === 0 ||
                  rows[index - 1].sectionId !== row.sectionId) && (
                  <div
                    className="symbol-picker-section-title"
                    data-section={row.sectionId}
                  >
                    {t(`symbolPicker.section.${row.sectionId}`)}
                  </div>
                )}
              <PickerRow
                index={index}
                onHover={hover}
                onPick={onPick}
                row={row}
                selectedCol={index === selectedRow ? selectedCol : -1}
              />
            </Fragment>
          ))
        )}
      </div>
      <div className="symbol-picker-footer">
        {selectedItem && (
          <>
            <span className="symbol-picker-footer-char">
              {selectedItem.char}
            </span>
            <span className="symbol-picker-footer-label">
              {selectedItem.label}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** Whether Alt, Ctrl, Meta or Shift is held with the key. */
function hasModifier(event: ReactKeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

/** A key the IME is still composing with — Enter then commits a syllable, not a pick. */
function isComposing(event: ReactKeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/**
 * One row of cells. Memoised so a highlight move re-renders the row it leaves
 * and the row it enters, not the whole grid — hovering moves it on every cell
 * the pointer crosses.
 */
const PickerRow = memo(function PickerRow({
  index,
  onHover,
  onPick,
  row,
  selectedCol,
}: {
  index: number;
  onHover: (row: number, col: number) => void;
  onPick: (char: string) => void;
  row: GridRow;
  selectedCol: number;
}) {
  return (
    <div className="symbol-picker-row" role="presentation">
      {row.items.map((item, col) => (
        <button
          aria-label={item.label}
          aria-selected={col === selectedCol}
          className={`symbol-picker-cell btn-unstyled ${col === selectedCol ? "symbol-picker-cell-selected" : ""}`}
          key={item.id}
          onClick={() => onPick(item.char)}
          onMouseEnter={() => onHover(index, col)}
          role="option"
          tabIndex={-1}
          type="button"
        >
          {item.char}
        </button>
      ))}
    </div>
  );
});
