import type { ContentMode } from "./content-type-detector";
// §11.2.3 NodeView AI Menu — DOM-based AI action dropdown for NodeViews
// Works in both React NodeViews and plain ProseMirror NodeViews
import type { Editor } from "@tiptap/core";

import {
  dispatchAIAction,
  dispatchCustomInstruction,
} from "./ai-action-dispatcher";
import { getActionsForMode } from "./contextual-ai-actions";

/**
 * Show a DOM-based AI action dropdown menu anchored to the given button element.
 * Returns a cleanup function to remove the menu.
 *
 * @param targetPos  Position of the target block in the document.
 *                   When provided, actions use the correct block for result placement.
 */
export function showNodeViewAIMenu(
  anchorEl: HTMLElement,
  mode: ContentMode,
  _blockText: string,
  editor: Editor,
  targetPos?: number,
): () => void {
  // Remove any existing menu
  const existing = document.querySelector(".nodeview-ai-menu");
  if (existing) existing.remove();

  const actions = getActionsForMode(mode);
  const menu = document.createElement("div");
  menu.className = "nodeview-ai-menu";

  for (const action of actions) {
    const btn = document.createElement("button");
    btn.className = "nodeview-ai-menu-item";
    btn.textContent = action.label;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu.remove();
      if (targetPos != null) {
        dispatchAIAction(action, editor, targetPos);
      }
    });
    menu.appendChild(btn);
  }

  // Separator + Custom Instruction
  const sep = document.createElement("div");
  sep.className = "nodeview-ai-menu-separator";
  menu.appendChild(sep);

  const customBtn = document.createElement("button");
  customBtn.className = "nodeview-ai-menu-item";
  customBtn.textContent = "Custom Instruction";
  customBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    menu.remove();
    if (targetPos != null) {
      dispatchCustomInstruction(editor, targetPos);
    }
  });
  menu.appendChild(customBtn);

  // Position relative to anchor
  document.body.appendChild(menu);
  positionMenu(menu, anchorEl);

  // Close on outside click
  const closeHandler = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener("mousedown", closeHandler);
    }
  };
  // Delay to avoid the triggering click itself closing the menu
  requestAnimationFrame(() => {
    document.addEventListener("mousedown", closeHandler);
  });

  // Close on Escape
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      menu.remove();
      document.removeEventListener("keydown", keyHandler);
      document.removeEventListener("mousedown", closeHandler);
    }
  };
  requestAnimationFrame(() => {
    document.addEventListener("keydown", keyHandler);
  });

  return () => {
    menu.remove();
    document.removeEventListener("mousedown", closeHandler);
    document.removeEventListener("keydown", keyHandler);
  };
}

function positionMenu(menu: HTMLElement, anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();

  let top = rect.bottom + 4;
  let left = rect.left;

  // Flip up if not enough space below
  if (top + menuRect.height > window.innerHeight - 8) {
    top = rect.top - menuRect.height - 4;
  }
  // Keep within right edge
  if (left + menuRect.width > window.innerWidth - 8) {
    left = window.innerWidth - menuRect.width - 8;
  }

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}
