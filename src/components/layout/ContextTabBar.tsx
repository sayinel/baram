// §82 Context tab bar — full multi-context UI
import { useCallback, useEffect, useRef, useState } from "react";

import { Plus, X } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useContextStore } from "../../stores/context/context";
import { switchContext } from "../../stores/file/file";
import { useWorkspaceStore } from "../../stores/file/workspace";
import "../../styles/context-tab-bar.css";
import { ContextAddMenu } from "./ContextAddMenu";

export function ContextTabBar() {
  const { contexts, activeContextId, removeContext } = useContextStore(
    useShallow((s) => ({
      contexts: s.contexts,
      activeContextId: s.activeContextId,
      removeContext: s.removeContext,
    })),
  );

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [renamingId, setRenamingId] = useState<null | string>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  // §82 Drag-to-reorder state
  const [dragId, setDragId] = useState<null | string>(null);
  const [dropIdx, setDropIdx] = useState<null | number>(null);
  const dragStartX = useRef(0);
  const didDrag = useRef(false);
  const dropIdxRef = useRef<null | number>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // §82 Drag-to-reorder handlers
  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return; // left-click only
    dragStartX.current = e.clientX;
    didDrag.current = false;
    dropIdxRef.current = null;

    const onMove = (ev: MouseEvent) => {
      if (!didDrag.current && Math.abs(ev.clientX - dragStartX.current) > 4) {
        didDrag.current = true;
        setDragId(id);
      }
      if (!didDrag.current) return;

      // Find drop position from tab elements
      const bar = barRef.current;
      if (!bar) return;
      const tabs = Array.from(
        bar.querySelectorAll<HTMLElement>(
          ".context-tab:not(.context-tab--add)",
        ),
      );
      let idx = tabs.length;
      for (let i = 0; i < tabs.length; i++) {
        const rect = tabs[i].getBoundingClientRect();
        if (ev.clientX < rect.left + rect.width / 2) {
          idx = i;
          break;
        }
      }
      dropIdxRef.current = idx;
      setDropIdx(idx);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);

      if (didDrag.current) {
        const store = useContextStore.getState();
        const ids = store.contexts.map((c) => c.id);
        const fromIdx = ids.indexOf(id);
        const finalDropIdx = dropIdxRef.current ?? fromIdx;
        if (fromIdx !== -1 && finalDropIdx !== fromIdx) {
          const newIds = [...ids];
          newIds.splice(fromIdx, 1);
          newIds.splice(
            finalDropIdx > fromIdx ? finalDropIdx - 1 : finalDropIdx,
            0,
            id,
          );
          store.reorderContexts(newIds);
        }
      }
      setDragId(null);
      setDropIdx(null);
      dropIdxRef.current = null;
      didDrag.current = false;
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // §82 Right-click context menu state
  const [ctxMenu, setCtxMenu] = useState<null | {
    contextId: string;
    x: number;
    y: number;
  }>(null);

  const handleClose = useCallback(
    async (e: React.MouseEvent, contextId: string) => {
      e.stopPropagation();
      const wasActive =
        useContextStore.getState().activeContextId === contextId;
      // Capture the vaultType BEFORE removal — removeContext drops it from state.
      const closedVaultType = useContextStore
        .getState()
        .contexts.find((c) => c.id === contextId)?.vaultType;

      // Close editor tabs belonging to this context
      const { useEditorStore } = await import("../../stores/editor/editor");
      const tabs = useEditorStore.getState().tabs;
      for (const tab of tabs.filter((t) => t.contextId === contextId)) {
        useEditorStore.getState().closeTab(tab.id);
      }

      await removeContext(contextId);

      if (wasActive) {
        const newActive = useContextStore.getState().activeContextId;
        if (newActive) {
          await switchContext(newActive);
        } else {
          // No contexts left — clear everything, show home screen
          const { useFileStore } = await import("../../stores/file/file");
          useFileStore.getState().closeFolder();
        }
      }

      // §82 If we just closed the context backing the current space, revert to
      // the Writing space (runs after switchContext so the tree stays loaded).
      useWorkspaceStore.getState().revertSpaceIfContextClosed(closedVaultType);
    },
    [removeContext],
  );

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent, contextId: string) => {
      if (e.button === 1) {
        e.preventDefault();
        handleClose(e, contextId);
      }
    },
    [handleClose],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, contextId: string) => {
      e.preventDefault();
      setCtxMenu({ contextId, x: e.clientX, y: e.clientY });
    },
    [],
  );

  // §89 Hide FileContexts from context tab bar — they appear as global editor tabs instead
  const visibleContexts = contexts.filter((c) => c.contextType !== "file");

  // Show tab bar when any vault/folder contexts are open (so "+" is accessible)
  if (visibleContexts.length === 0) return null;

  return (
    <div className="context-tab-bar" ref={barRef}>
      {visibleContexts.map((ctx, i) => (
        <button
          className={[
            "context-tab",
            ctx.id === activeContextId && "context-tab--active",
            dragId === ctx.id && "context-tab--dragging",
            dragId && dropIdx === i && "context-tab--drop-before",
            dragId &&
              dropIdx === i + 1 &&
              i === contexts.length - 1 &&
              "context-tab--drop-after",
          ]
            .filter(Boolean)
            .join(" ")}
          key={ctx.id}
          onClick={() => {
            if (!didDrag.current) switchContext(ctx.id);
          }}
          onContextMenu={(e) => handleContextMenu(e, ctx.id)}
          onDoubleClick={(e) => {
            e.preventDefault();
            setRenamingId(ctx.id);
          }}
          onMouseDown={(e) => {
            if (e.button === 1) {
              handleMiddleClick(e, ctx.id);
            } else {
              handleDragStart(e, ctx.id);
            }
          }}
          title={ctx.path}
        >
          <span
            className="context-tab__dot"
            style={{ backgroundColor: ctx.color }}
          />
          {renamingId === ctx.id ? (
            <input
              autoFocus
              className="context-tab__rename-input"
              defaultValue={ctx.label}
              onBlur={(e) => {
                const val = e.currentTarget.value.trim();
                if (val)
                  useContextStore.getState().updateContextLabel(ctx.id, val);
                setRenamingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = e.currentTarget.value.trim();
                  if (val)
                    useContextStore.getState().updateContextLabel(ctx.id, val);
                  setRenamingId(null);
                }
                if (e.key === "Escape") setRenamingId(null);
              }}
            />
          ) : (
            <span className="context-tab__label">{ctx.label}</span>
          )}
          <span
            className="context-tab__close"
            onClick={(e) => handleClose(e, ctx.id)}
            title="Close"
          >
            <X size={12} />
          </span>
        </button>
      ))}

      <button
        className="context-tab context-tab--add"
        onClick={() => setShowAddMenu((v) => !v)}
        ref={addBtnRef}
        title="Open folder"
      >
        <Plus size={14} />
      </button>

      {showAddMenu && (
        <ContextAddMenu
          anchorRef={addBtnRef}
          onClose={() => setShowAddMenu(false)}
        />
      )}

      {ctxMenu && (
        <ContextTabContextMenu
          contextId={ctxMenu.contextId}
          onClose={() => setCtxMenu(null)}
          x={ctxMenu.x}
          y={ctxMenu.y}
        />
      )}
    </div>
  );
}

// --- Right-click context menu (inline) ---

const PRESET_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

function ContextTabContextMenu({
  contextId,
  x,
  y,
  onClose,
}: {
  contextId: string;
  onClose: () => void;
  x: number;
  y: number;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const aliasInputRef = useRef<HTMLInputElement>(null);

  const ctx = useContextStore
    .getState()
    .contexts.find((c) => c.id === contextId);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  if (!ctx) return null;

  const handleRename = () => {
    setRenaming(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleRenameSubmit = (newLabel: string) => {
    if (newLabel.trim()) {
      useContextStore.getState().updateContextLabel(contextId, newLabel.trim());
    }
    onClose();
  };

  const handleEditAlias = () => {
    setEditingAlias(true);
    setTimeout(() => aliasInputRef.current?.focus(), 0);
  };

  const handleAliasSubmit = (newAlias: string) => {
    useContextStore.getState().updateContextAlias(contextId, newAlias.trim());
    onClose();
  };

  const handleColorChange = (color: string) => {
    useContextStore.getState().updateContextColor(contextId, color);
    onClose();
  };

  const handleCloseCtx = async () => {
    onClose();
    const closedVaultType = ctx.vaultType;
    await useContextStore.getState().removeContext(contextId);
    // §82 Revert to Writing if this closed the current space's context.
    useWorkspaceStore.getState().revertSpaceIfContextClosed(closedVaultType);
  };

  const handleCloseOthers = async () => {
    onClose();
    const store = useContextStore.getState();
    const others = store.contexts.filter((c) => c.id !== contextId);
    for (const other of others) {
      await store.removeContext(other.id).catch(() => {});
    }
  };

  return (
    <div className="context-ctx-menu" ref={menuRef} style={{ left: x, top: y }}>
      {renaming ? (
        <input
          className="context-ctx-menu__input"
          defaultValue={ctx.label}
          onBlur={(e) => handleRenameSubmit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameSubmit(e.currentTarget.value);
            if (e.key === "Escape") onClose();
          }}
          ref={inputRef}
        />
      ) : editingAlias ? (
        <input
          className="context-ctx-menu__input"
          defaultValue={ctx.alias ?? ""}
          onBlur={(e) => handleAliasSubmit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAliasSubmit(e.currentTarget.value);
            if (e.key === "Escape") onClose();
          }}
          placeholder="vault alias"
          ref={aliasInputRef}
        />
      ) : (
        <>
          <button className="context-ctx-menu__item" onClick={handleRename}>
            Rename
          </button>
          {ctx.contextType === "vault" && (
            <button
              className="context-ctx-menu__item"
              onClick={handleEditAlias}
            >
              Edit Alias{ctx.alias ? ` (${ctx.alias})` : ""}
            </button>
          )}
          <button
            className="context-ctx-menu__item"
            onClick={() => setShowColors((v) => !v)}
          >
            Change Color
          </button>
          {showColors && (
            <div className="context-ctx-menu__colors">
              {PRESET_COLORS.map((c) => (
                <button
                  className="context-ctx-menu__color-btn"
                  key={c}
                  onClick={() => handleColorChange(c)}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          )}
          <div className="context-ctx-menu__sep" />
          <button className="context-ctx-menu__item" onClick={handleCloseCtx}>
            Close
          </button>
          {useContextStore.getState().contexts.length > 1 && (
            <button
              className="context-ctx-menu__item"
              onClick={handleCloseOthers}
            >
              Close Others
            </button>
          )}
        </>
      )}
    </div>
  );
}
