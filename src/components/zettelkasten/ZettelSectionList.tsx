// §101 Zettel hub — collapsible section header + generic {path,title} list.
// Shared by MOCs/Recent here; the Inbox section (ZettelInboxList) reuses
// ZettelHubSectionHeader for a consistent look.
import type { ReactNode } from "react";

import type { ZettelHubListItem } from "./use-zettel-hub-data";

import { ChevronDown, ChevronRight, Star } from "lucide-react";

import { openZettelHubNote } from "./open-hub-note";

interface ZettelHubSectionHeaderProps {
  collapsed: boolean;
  icon: ReactNode;
  label: string;
  onToggle: () => void;
}

interface ZettelSectionListProps {
  collapsed: boolean;
  emptyHint: string;
  favoriteIds?: string[];
  icon: ReactNode;
  items: ZettelHubListItem[];
  label: string;
  loading: boolean;
  onToggleCollapse: () => void;
  onToggleFavorite?: (id: string) => void;
}

/** Collapsible section header: chevron + icon + label (count, if any, is baked into `label`). */
export function ZettelHubSectionHeader({
  collapsed,
  icon,
  label,
  onToggle,
}: ZettelHubSectionHeaderProps) {
  return (
    <button
      aria-expanded={!collapsed}
      className="zettel-hub-section-header btn-unstyled flex-header"
      onClick={onToggle}
    >
      <span className="zettel-hub-section-title">
        {collapsed ? (
          <ChevronRight size={14} strokeWidth={1.5} />
        ) : (
          <ChevronDown size={14} strokeWidth={1.5} />
        )}
        {icon}
        <span>{label}</span>
      </span>
    </button>
  );
}

/** Generic collapsible {path,title} list — used for MOCs, Favorites, and Recent. */
export function ZettelSectionList({
  collapsed,
  emptyHint,
  favoriteIds,
  icon,
  items,
  label,
  loading,
  onToggleCollapse,
  onToggleFavorite,
}: ZettelSectionListProps) {
  return (
    <div className="zettel-hub-section">
      <ZettelHubSectionHeader
        collapsed={collapsed}
        icon={icon}
        label={label}
        onToggle={onToggleCollapse}
      />
      {!collapsed && (
        <div className="zettel-hub-section-body">
          {items.length === 0
            ? !loading && (
                <div className="zettel-hub-empty-hint">{emptyHint}</div>
              )
            : items.map((item) => {
                const canFavorite =
                  Boolean(item.id) && Boolean(onToggleFavorite);
                if (!canFavorite) {
                  return (
                    <button
                      className="zettel-hub-list-row btn-unstyled text-truncate"
                      key={item.path}
                      onClick={() => void openZettelHubNote(item.path)}
                      title={item.title}
                    >
                      <span className="text-truncate">{item.title}</span>
                    </button>
                  );
                }
                const id = item.id!;
                const active = favoriteIds?.includes(id) ?? false;
                return (
                  <div
                    className="zettel-hub-list-row flex-header"
                    key={item.path}
                    onClick={() => void openZettelHubNote(item.path)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void openZettelHubNote(item.path);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    title={item.title}
                  >
                    <span className="text-truncate">{item.title}</span>
                    <button
                      aria-label={active ? "Unfavorite" : "Favorite"}
                      className={`zettel-hub-fav-btn btn-unstyled icon-btn${
                        active ? "zettel-hub-fav-active" : ""
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite!(id);
                      }}
                    >
                      <Star
                        fill={active ? "currentColor" : "none"}
                        size={13}
                        strokeWidth={1.5}
                      />
                    </button>
                  </div>
                );
              })}
        </div>
      )}
    </div>
  );
}
