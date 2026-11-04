// §4.5/§35 Shared list-navigation for palette-style overlays (CommandPalette, QuickSwitcher, PluginPrompt)
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";

export interface UsePaletteListNavOptions {
  /** Whether the overlay is currently open — drives the reset-on-open effect. */
  isOpen: boolean;
  /** Current result/command count. A number, not the list itself — callers keep their own list shape. */
  itemCount: number;
  /** Called with the current selected index when Enter is pressed on a valid item. */
  onEnter: (index: number) => void;
  /** Called on Escape (typically the overlay's own toggle-closed action). */
  onEscape: () => void;
  /** Extra state to reset when the overlay opens (query, mode-specific state, focus). Runs after selectedIndex resets to 0. */
  onOpen?: () => void;
}

export interface UsePaletteListNavResult {
  handleKeyDown: (e: KeyboardEvent) => void;
  selectedIndex: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
}

/**
 * Shared Escape/ArrowDown/ArrowUp/Enter handling + selectedIndex clamp + reset-on-open,
 * factored out of CommandPalette and QuickSwitcher (identical in both — see split-review-ui §4).
 */
export function usePaletteListNav({
  isOpen,
  itemCount,
  onEnter,
  onEscape,
  onOpen,
}: UsePaletteListNavOptions): UsePaletteListNavResult {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
      onOpen?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onOpen intentionally not a dep: it closes over per-render state setters and would fire this effect every render.
  }, [isOpen]);

  // Clamp selectedIndex
  useEffect(() => {
    if (selectedIndex >= itemCount) {
      setSelectedIndex(Math.max(0, itemCount - 1));
    }
  }, [itemCount, selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // §385 `PluginPrompt`'s `onEscape` settles the prompt, which hands focus back to where
        // it came from — the editor, when opened from it — inside this keydown. Left uncancelled,
        // the keydown is followed by a `keypress` (charCode 27) that the macOS WebView sends to
        // the newly focused element, and `prosemirror-view`'s keypress handler inserts it as text
        // when the selection is not a text selection inside one parent (measured 2026-11-04: a
        // right-click at a line end leaves such a selection). A cancelled keydown fires no
        // keypress — the prompt's input box, which cancels its Escape, left none in that run.
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) =>
          itemCount === 0 ? 0 : Math.min(i + 1, itemCount - 1),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (itemCount === 0 ? 0 : Math.max(i - 1, 0)));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < itemCount) {
          onEnter(selectedIndex);
        }
      }
    },
    [itemCount, selectedIndex, onEnter, onEscape],
  );

  return { handleKeyDown, selectedIndex, setSelectedIndex };
}
