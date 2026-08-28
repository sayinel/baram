// §4.5/§35 Shared overlay + stopPropagation + input shell for CommandPalette and QuickSwitcher
import type { KeyboardEvent, ReactNode } from "react";

interface PaletteOverlayProps {
  children: ReactNode;
  /** Backdrop click handler — typically the overlay's own toggle-closed action. */
  onClose: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  overlayClassName: string;
  paletteClassName: string;
}

export function PaletteOverlay({
  children,
  onClose,
  onKeyDown,
  overlayClassName,
  paletteClassName,
}: PaletteOverlayProps) {
  return (
    <div className={overlayClassName} onClick={onClose}>
      <div
        className={paletteClassName}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
