// §30.3b Graph View — node context-menu item builder
import type { MenuItem } from "../toolbar/context-menu-types";

import { displayName } from "./graph-utils";

const TAG_PREFIX = "tag:";

export interface GraphNodeMenuActions {
  onExclude: (nodeId: string) => void;
  onOpen: (nodeId: string) => void;
  onTogglePin: (nodeId: string, pinned: boolean) => void;
}

export interface GraphNodeMenuTarget {
  isGhost: boolean;
  isTag: boolean;
  nodeId: string;
  pinned: boolean;
}

/**
 * Build the right-click menu for a graph node. Ghost/tag nodes have no file
 * to open; every node can be pinned, copied, or excluded from the graph.
 */
export function buildGraphNodeMenu(
  target: GraphNodeMenuTarget,
  actions: GraphNodeMenuActions,
): MenuItem[] {
  const items: MenuItem[] = [];

  if (!target.isTag && !target.isGhost) {
    items.push({
      label: "Open",
      action: () => actions.onOpen(target.nodeId),
    });
  }

  items.push(
    {
      label: target.pinned ? "Unpin" : "Pin",
      action: () => actions.onTogglePin(target.nodeId, target.pinned),
    },
    {
      label: target.isTag ? "Copy tag" : "Copy wikilink",
      action: () => {
        void navigator.clipboard.writeText(nodeClipboardText(target));
      },
    },
    { label: "", action: () => {}, separator: true },
    {
      label: "Exclude from graph",
      action: () => actions.onExclude(target.nodeId),
    },
  );

  return items;
}

/** Copy a graph node as pasteable markdown: `#tag` for tags, `[[name]]` otherwise */
export function nodeClipboardText(target: GraphNodeMenuTarget): string {
  if (target.isTag) {
    return `#${target.nodeId.slice(TAG_PREFIX.length)}`;
  }
  return `[[${displayName(target.nodeId)}]]`;
}
