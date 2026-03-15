// §32 Hover Preview — shows document preview when Cmd+hovering over wikilinks
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { readFile } from "../../ipc/invoke";
import { useFileStore } from "../../stores/file/file";
import { findBlockContent } from "../../utils/editor/block-nav";
import { resolveWikilinkTarget } from "../../utils/editor/wikilink-nav";

const MAX_LINES = 20;
const POPUP_MAX_WIDTH = 400;
const POPUP_MAX_HEIGHT = 300;
const HOVER_DELAY = 300;
const GAP = 4;
const VIEWPORT_PADDING = 8;

interface HoverTarget {
  blockId?: string; // §30c block reference hover
  element: HTMLElement;
  target: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export function calcPosition(
  rect: { bottom: number; left: number; top: number; width: number },
  viewport: { height: number; width: number },
  popupSize: { height: number; width: number },
): { left: number; top: number } {
  let top: number;
  let left: number;

  if (rect.bottom + GAP + popupSize.height <= viewport.height) {
    top = rect.bottom + GAP;
  } else {
    top = rect.top - GAP - popupSize.height;
  }

  left = rect.left + rect.width / 2 - popupSize.width / 2;

  if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
  if (left + popupSize.width > viewport.width - VIEWPORT_PADDING) {
    left = viewport.width - VIEWPORT_PADDING - popupSize.width;
  }

  return { top, left };
}

export function HoverPreview() {
  const [visible, setVisible] = useState(false);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const hoverTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  const currentTargetRef = useRef<null | string>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const isOverPopupRef = useRef(false);

  const showPreview = useCallback(async (hoverTarget: HoverTarget) => {
    const { target, element, blockId } = hoverTarget;
    const resolved = resolveWikilinkTarget(target);
    if (!resolved) return;

    // Cache-first: check openFiles, then IPC
    let fileContent: string;
    const cached = useFileStore.getState().openFiles.get(resolved.path);
    if (cached !== undefined) {
      fileContent = cached;
    } else {
      try {
        fileContent = await readFile(resolved.path);
      } catch {
        return;
      }
    }

    // Don't show if target changed during async load
    if (currentTargetRef.current !== target) return;

    // §30c Block reference: show only the referenced block content
    let previewContent: string;
    let previewTitle: string;
    if (blockId) {
      const blockText = findBlockContent(fileContent, blockId);
      previewContent = blockText ?? `Block ^${blockId} not found`;
      previewTitle = `${resolved.name} > ^${blockId}`;
    } else {
      previewContent =
        truncatePreview(fileContent, MAX_LINES) || "Empty document";
      previewTitle = resolved.name;
    }

    setTitle(previewTitle);
    setContent(previewContent);

    const rect = element.getBoundingClientRect();
    const pos = calcPosition(
      {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
      },
      { width: window.innerWidth, height: window.innerHeight },
      { width: POPUP_MAX_WIDTH, height: POPUP_MAX_HEIGHT },
    );
    setPosition(pos);
    setVisible(true);
  }, []);

  const hidePreview = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // Delay hiding to allow moving mouse to popup
    setTimeout(() => {
      if (!isOverPopupRef.current) {
        setVisible(false);
        currentTargetRef.current = null;
      }
    }, 50);
  }, []);

  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      // Require Cmd (Meta) or Ctrl key
      if (!(e.metaKey || e.ctrlKey)) return;

      const wikilinkEl = (e.target as HTMLElement).closest?.(
        "[data-target].wikilink",
      ) as HTMLElement | null;
      // §30c Also detect block-reference elements
      const blockRefEl = !wikilinkEl
        ? ((e.target as HTMLElement).closest?.(
            "[data-target].block-reference",
          ) as HTMLElement | null)
        : null;
      const hoverEl = wikilinkEl || blockRefEl;
      if (!hoverEl) return;

      const dataTarget = hoverEl.getAttribute("data-target");
      if (!dataTarget) return;

      // §30c Extract blockId if hovering over a block reference
      const blockId = blockRefEl?.getAttribute("data-block-id") || undefined;

      // Avoid re-triggering for same target
      const cacheKey = blockId ? `${dataTarget}#^${blockId}` : dataTarget;
      if (currentTargetRef.current === cacheKey && visible) return;

      currentTargetRef.current = cacheKey;

      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        showPreview({ target: dataTarget, element: hoverEl, blockId });
      }, HOVER_DELAY);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const hoverEl = (e.target as HTMLElement).closest?.(
        ".wikilink, .block-reference",
      );
      if (hoverEl) {
        hidePreview();
      }
    };

    // Hide when Cmd/Ctrl key is released
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control") {
        isOverPopupRef.current = false;
        setVisible(false);
        currentTargetRef.current = null;
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
      }
    };

    document.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("mouseout", handleMouseOut);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      document.removeEventListener("keyup", handleKeyUp);
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, [visible, showPreview, hidePreview]);

  if (!visible) return null;

  return createPortal(
    <div
      className="hover-preview"
      onMouseEnter={() => {
        isOverPopupRef.current = true;
      }}
      onMouseLeave={() => {
        isOverPopupRef.current = false;
        setVisible(false);
        currentTargetRef.current = null;
      }}
      ref={popupRef}
      style={{ top: position.top, left: position.left }}
    >
      <div className="hover-preview-title">{title}</div>
      <div className="hover-preview-divider" />
      <div className="hover-preview-content">
        <pre>{content}</pre>
      </div>
    </div>,
    document.body,
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function truncatePreview(content: string, maxLines: number): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join("\n") + "\n…";
}
