import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { Editor } from "@tiptap/react";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Hash,
  Link,
  Replace,
  Sparkles,
  Trash2,
} from "lucide-react";

import {
  addBlockId,
  editBlockId,
} from "../../extensions/plugins/block-id-decoration";
// §4.8 Block Handle menu — item list + submenus, mounted only while open
// §11.2.3 BlockHandle AI submenu — contextual AI actions per block type
import { chainWithVimExternalEdit } from "../../extensions/plugins/vim/vim-keys";
import { useEditorStore } from "../../stores/editor/editor";
import {
  dispatchAIAction,
  dispatchCustomInstruction,
} from "../../utils/ai-action-dispatcher";
import {
  getBlockContentMode,
  getBlockTextContent,
} from "../../utils/block-ai-utils";
import { getActionsForMode } from "../../utils/contextual-ai-actions";
import { blockBasename, buildBlockLink } from "../../utils/toolbar/block-link";
import { buildTurnIntoItems } from "../../utils/toolbar/block-turn-into";
import {
  useMenuViewportClamp,
  useSubmenuReposition,
} from "./use-submenu-reposition";

interface BlockHandleMenuProps {
  editor: Editor;
  left: number;
  onClose: () => void;
  pos: number;
  top: number;
}

interface DropdownItem {
  action: () => void;
  icon?: ReactNode;
  label: string;
  separator?: boolean;
}

const ICON_SIZE = 14;

// §4.8 Block Handle dropdown — item list + Turn into / Ask AI submenus.
// Mounted only while the handle's menu is open (see BlockHandle.tsx), so the
// menu-data computation below (doc.nodeAt, getBlockTextContent,
// buildTurnIntoItems's 18 isActive checks) only runs while a user is actually
// looking at the menu, not on every mousemove-driven re-render of the handle.
export function BlockHandleMenu({
  editor,
  pos,
  top,
  left,
  onClose,
}: BlockHandleMenuProps) {
  const [aiSubOpen, setAiSubOpen] = useState(false);
  const [turnIntoOpen, setTurnIntoOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const aiSubRef = useRef<HTMLDivElement>(null);
  const turnIntoRef = useRef<HTMLDivElement>(null);

  useMenuViewportClamp(menuRef);
  const repositionSubmenu = useSubmenuReposition(menuRef);

  useLayoutEffect(() => {
    if (aiSubOpen) repositionSubmenu(aiSubRef.current);
  }, [aiSubOpen, repositionSubmenu]);

  useLayoutEffect(() => {
    if (turnIntoOpen) repositionSubmenu(turnIntoRef.current);
  }, [turnIntoOpen, repositionSubmenu]);

  // Close menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // §4.8 Copy link helpers
  const copyBlockLink = useCallback(
    (form: "ref" | "wikilink") => {
      const { activeTabId, tabs } = useEditorStore.getState();
      const filePath = tabs.find((t) => t.id === activeTabId)?.filePath ?? "";
      const base = blockBasename(filePath);

      // addBlockId is synchronous (generateBlockId + setNodeMarkup + dispatch),
      // so the id is readable right after the call — no rAF needed.
      let id = editor.state.doc.nodeAt(pos)?.attrs.blockId as null | string;
      if (!id) {
        addBlockId(editor.view, pos);
        id = editor.state.doc.nodeAt(pos)?.attrs.blockId as null | string;
      }
      if (id)
        void navigator.clipboard.writeText(buildBlockLink(base, id, form));
    },
    [editor, pos],
  );

  const handleMenuAction = useCallback(
    (action: () => void) => {
      action();
      onClose();
    },
    [onClose],
  );

  const handleAIAction = useCallback(
    (action: Parameters<typeof dispatchAIAction>[0]) => {
      onClose();
      dispatchAIAction(action, editor, pos);
    },
    [editor, pos, onClose],
  );

  const handleCustomInstruction = useCallback(() => {
    onClose();
    dispatchCustomInstruction(editor, pos);
  }, [editor, pos, onClose]);

  // Determine AI actions for the current block
  const currentNode = editor.state.doc.nodeAt(pos);
  const aiMode = currentNode ? getBlockContentMode(currentNode) : null;
  const aiActions = aiMode ? getActionsForMode(aiMode) : [];
  const blockHasContent = currentNode
    ? getBlockTextContent(currentNode).trim().length > 0
    : false;

  // §4.8 Turn-into submenu — block type conversions
  const turnIntoItems = buildTurnIntoItems(editor, pos);

  // Build block ID menu item for paragraph/heading nodes
  const blockIdItem: DropdownItem | null = (() => {
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return null;
    if (node.type.name !== "paragraph" && node.type.name !== "heading")
      return null;
    const existingId = node.attrs.blockId as null | string;
    if (existingId) {
      return {
        label: `Edit Block ID (^${existingId})`,
        separator: true,
        icon: <Hash size={ICON_SIZE} />,
        action: () => {
          editBlockId(editor.view, pos);
          onClose();
        },
      };
    }
    return {
      label: "Add Block ID",
      separator: true,
      icon: <Hash size={ICON_SIZE} />,
      action: () => {
        addBlockId(editor.view, pos);
      },
    };
  })();

  // §4.8 Copy link / Copy block ref — paragraph/heading only (blockId is
  // schema-supported only on those node types, same gate as blockIdItem).
  const copyLinkItems: DropdownItem[] = (() => {
    const node = editor.state.doc.nodeAt(pos);
    if (
      !node ||
      (node.type.name !== "paragraph" && node.type.name !== "heading")
    )
      return [];
    return [
      {
        label: "Copy link",
        icon: <Link size={ICON_SIZE} />,
        action: () => copyBlockLink("wikilink"),
      },
      {
        label: "Copy block ref",
        icon: <Hash size={ICON_SIZE} />,
        action: () => copyBlockLink("ref"),
      },
    ];
  })();

  const menuItems: DropdownItem[] = [
    {
      label: "Duplicate",
      icon: <Copy size={ICON_SIZE} />,
      action: () => {
        const node = editor.state.doc.nodeAt(pos);
        if (node) {
          const endPos = pos + node.nodeSize;
          chainWithVimExternalEdit(editor)
            .focus()
            .insertContentAt(endPos, node.toJSON())
            .run();
        }
      },
    },
    ...copyLinkItems,
    {
      label: "Move Up",
      separator: true,
      icon: <ArrowUp size={ICON_SIZE} />,
      action: () => {
        if (pos > 0) {
          const node = editor.state.doc.nodeAt(pos);
          const prevResolved = editor.state.doc.resolve(pos);
          if (node && prevResolved.nodeBefore) {
            const prevPos = pos - prevResolved.nodeBefore.nodeSize;
            chainWithVimExternalEdit(editor)
              .focus()
              .deleteRange({ from: pos, to: pos + node.nodeSize })
              .insertContentAt(prevPos, node.toJSON())
              .run();
          }
        }
      },
    },
    {
      label: "Move Down",
      icon: <ArrowDown size={ICON_SIZE} />,
      action: () => {
        const node = editor.state.doc.nodeAt(pos);
        if (node) {
          const endPos = pos + node.nodeSize;
          const nextNode = editor.state.doc.nodeAt(endPos);
          if (nextNode) {
            const newPos = endPos + nextNode.nodeSize;
            chainWithVimExternalEdit(editor)
              .focus()
              .deleteRange({ from: pos, to: endPos })
              .insertContentAt(newPos - node.nodeSize, node.toJSON())
              .run();
          }
        }
      },
    },
    {
      label: "Delete",
      icon: <Trash2 size={ICON_SIZE} />,
      action: () => {
        const node = editor.state.doc.nodeAt(pos);
        if (node) {
          chainWithVimExternalEdit(editor)
            .focus()
            .deleteRange({ from: pos, to: pos + node.nodeSize })
            .run();
        }
      },
    },
    ...(blockIdItem ? [blockIdItem] : []),
  ];

  return (
    <div
      className="block-handle-menu"
      ref={menuRef}
      style={{
        top: `${top}px`,
        left: `${left}px`,
      }}
    >
      {/* Turn into submenu — first entry §4.8 */}
      {turnIntoItems.length > 0 && (
        <div
          className="block-handle-ai-trigger"
          onMouseEnter={() => setTurnIntoOpen(true)}
          onMouseLeave={() => setTurnIntoOpen(false)}
        >
          <button className="block-handle-menu-item block-handle-ai-item">
            <span className="block-handle-item-left">
              <Replace size={ICON_SIZE} />
              <span>Turn into</span>
            </span>
            <span className="block-handle-ai-arrow">{"▸"}</span>
          </button>
          {turnIntoOpen && (
            <div className="block-handle-ai-submenu" ref={turnIntoRef}>
              {turnIntoItems.map((item) => (
                <Fragment key={item.label}>
                  {item.separator && <div className="block-handle-separator" />}
                  <button
                    className="block-handle-menu-item"
                    onClick={() => handleMenuAction(() => item.run())}
                  >
                    {item.isActive ? `✓ ${item.label}` : item.label}
                  </button>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      )}
      {turnIntoItems.length > 0 && <div className="block-handle-separator" />}

      {menuItems.map((item, i) => (
        <div key={i}>
          {item.separator && <div className="block-handle-separator" />}
          <button
            className="block-handle-menu-item"
            onClick={() => handleMenuAction(item.action)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        </div>
      ))}

      {/* AI Submenu */}
      {blockHasContent && (
        <>
          <div className="block-handle-separator" />
          <div
            className="block-handle-ai-trigger"
            onMouseEnter={() => setAiSubOpen(true)}
            onMouseLeave={() => setAiSubOpen(false)}
          >
            <button className="block-handle-menu-item block-handle-ai-item">
              <span className="block-handle-item-left">
                <Sparkles size={ICON_SIZE} />
                <span>Ask AI</span>
              </span>
              <span className="block-handle-ai-arrow">{"▸"}</span>
            </button>

            {aiSubOpen && (
              <div className="block-handle-ai-submenu" ref={aiSubRef}>
                {aiActions.map((action) => (
                  <button
                    className="block-handle-menu-item"
                    key={action.id}
                    onClick={() => handleAIAction(action)}
                  >
                    {action.label}
                  </button>
                ))}
                <div className="block-handle-separator" />
                <button
                  className="block-handle-menu-item"
                  onClick={handleCustomInstruction}
                >
                  Custom Instruction
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
