import type { ZettelHubInboxItem } from "./use-zettel-hub-data";

// §101 Zettel hub — Inbox queue: fleeting notes awaiting triage.
// Row click opens the note; hover-revealed (but always-mounted, keyboard
// reachable) actions promote or delete it.
import { ArrowUp, Inbox, X } from "lucide-react";

import { deleteFile } from "../../ipc/invoke";
import { promoteFleeting } from "../../services/zettelkasten-service";
import { useUIStore } from "../../stores/ui/ui";
import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { showConfirm } from "../../utils/confirm-dialog";
import { logger } from "../../utils/logger";
import { openZettelHubNote } from "./open-hub-note";
import { ZettelHubSectionHeader } from "./ZettelSectionList";

interface ZettelInboxListProps {
  collapsed: boolean;
  items: ZettelHubInboxItem[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onToggleCollapse: () => void;
  zettelDir: string;
}

export function ZettelInboxList({
  collapsed,
  items,
  loading,
  onRefresh,
  onToggleCollapse,
  zettelDir,
}: ZettelInboxListProps) {
  const handlePromote = (item: ZettelHubInboxItem) => {
    useUIStore.getState().openZettelTitleDialog({
      onSubmit: (title) =>
        promoteFleeting(zettelDir, item.path, title)
          .then(() => onRefresh())
          .catch((err) => logger.error("[Zettel] promote failed:", err)),
      title: "Promote to Permanent Note",
      description: "Move this fleeting note from inbox/ to notes/.",
      confirmLabel: "Promote",
      initialTitle: item.title.slice(0, 80),
    });
  };

  const handleDelete = async (item: ZettelHubInboxItem) => {
    const ok = await showConfirm(
      `Delete "${item.title}"? This cannot be undone.`,
    );
    if (!ok) return;
    try {
      await deleteFile(item.path);
      useZettelIndexStore.getState().removeByPath(item.path);
      await onRefresh();
    } catch (err) {
      logger.error("[Zettel] delete inbox note failed:", err);
    }
  };

  return (
    <div className="zettel-hub-section">
      <ZettelHubSectionHeader
        collapsed={collapsed}
        icon={<Inbox size={14} strokeWidth={1.5} />}
        label={`INBOX (${items.length})`}
        onToggle={onToggleCollapse}
      />
      {!collapsed && (
        <div className="zettel-hub-section-body">
          {items.length === 0
            ? !loading && (
                <div className="zettel-hub-empty-hint">
                  Inbox is empty — press ⇧⌘N to capture a thought.
                </div>
              )
            : items.map((item) => (
                <div
                  className="zettel-hub-inbox-row flex-header"
                  key={item.path}
                  onClick={() => void openZettelHubNote(item.path)}
                >
                  <span className="zettel-hub-inbox-main text-truncate">
                    <span className="zettel-hub-inbox-title text-truncate">
                      {item.title}
                    </span>
                    {item.tags.length > 0 && (
                      <span className="zettel-hub-tag-pills">
                        {item.tags.slice(0, 2).map((tag) => (
                          <span className="zettel-hub-tag-pill" key={tag}>
                            #{tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <div className="zettel-hub-inbox-actions">
                    <button
                      aria-label={`Promote "${item.title}"`}
                      className="zettel-hub-inbox-action btn-unstyled icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePromote(item);
                      }}
                      title="Promote to Permanent Note"
                    >
                      <ArrowUp size={12} strokeWidth={1.5} />
                    </button>
                    <button
                      aria-label={`Delete "${item.title}"`}
                      className="zettel-hub-inbox-action btn-unstyled icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(item);
                      }}
                      title="Delete"
                    >
                      <X size={12} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}
