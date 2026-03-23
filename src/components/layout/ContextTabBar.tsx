// §82 Context tab bar — full multi-context UI
import { useCallback, useEffect, useRef, useState } from "react";

import { Plus, X } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useContextStore } from "../../stores/context/context";
import { switchContext } from "../../stores/file/file";
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
  const addBtnRef = useRef<HTMLButtonElement>(null);

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
      await removeContext(contextId);
      // If we closed the active context, switch to the new active one
      if (wasActive) {
        const newActive = useContextStore.getState().activeContextId;
        if (newActive) {
          await switchContext(newActive);
        } else {
          // No contexts left — clear file tree
          const { useFileStore } = await import("../../stores/file/file");
          useFileStore.getState().setRootPath(null as unknown as string);
          useFileStore.getState().setFileTree([]);
        }
      }
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

  // Show tab bar when any contexts are open (so "+" is accessible)
  if (contexts.length === 0) return null;

  return (
    <div className="context-tab-bar">
      {contexts.map((ctx) => (
        <button
          className={`context-tab ${ctx.id === activeContextId ? "context-tab--active" : ""}`}
          key={ctx.id}
          onClick={() => switchContext(ctx.id)}
          onContextMenu={(e) => handleContextMenu(e, ctx.id)}
          onMouseDown={(e) => handleMiddleClick(e, ctx.id)}
          title={ctx.path}
        >
          <span
            className="context-tab__dot"
            style={{ backgroundColor: ctx.color }}
          />
          <span className="context-tab__label">{ctx.label}</span>
          {contexts.length > 1 && (
            <span
              className="context-tab__close"
              onClick={(e) => handleClose(e, ctx.id)}
              title="Close"
            >
              <X size={12} />
            </span>
          )}
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
    await useContextStore.getState().removeContext(contextId);
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
