// §100/§101 Zettel hub — sidebar panel for the Zettel space.
// Actions bar + Inbox queue + MOCs + Recent sections.
import { useState } from "react";

import { Clock, FileText, Map as MapIcon, Star, Zap } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { getAction } from "../../keybindings/keybinding-actions";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import {
  toggleFavorite,
  useZettelFavoritesStore,
} from "../../stores/zettelkasten/zettel-favorites";
import { logger } from "../../utils/logger";
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";
import "../../styles/zettelkasten.css";
import { useZettelHubData } from "./use-zettel-hub-data";
import { ZettelInboxList } from "./ZettelInboxList";
import { ZettelSectionList } from "./ZettelSectionList";

type CollapseKey = "favorites" | "inbox" | "mocs" | "recent";

export function ZettelHubPanel() {
  const { zettelkastenEnabled, zettelkastenDirectory } = useSettingsStore(
    useShallow((s) => ({
      zettelkastenEnabled: s.zettelkastenEnabled,
      zettelkastenDirectory: s.zettelkastenDirectory,
    })),
  );
  const { rootPath } = useFileStore(
    useShallow((s) => ({ rootPath: s.rootPath })),
  );
  const dir = resolveZettelDir(rootPath, zettelkastenDirectory);
  const favoriteIds = useZettelFavoritesStore((s) => s.favoriteIds);

  const { favorites, inbox, loading, mocs, recent, refresh } = useZettelHubData(
    zettelkastenEnabled && dir ? dir : null,
  );

  const [collapsed, setCollapsed] = useState<Record<CollapseKey, boolean>>({
    favorites: false,
    inbox: false,
    mocs: false,
    recent: false,
  });
  const toggle = (key: CollapseKey) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const onToggleFavorite = (id: string) => {
    if (dir) {
      void toggleFavorite(dir, id).catch((e: unknown) =>
        logger.error("[Zettel] toggle favorite failed:", e),
      );
    }
  };

  return (
    <div className="zettel-hub">
      <div className="zettel-hub-actions">
        <button
          aria-label="New Zettel"
          className="zettel-hub-action"
          onClick={() => getAction("zettelkasten.newNote")?.()}
          title="New Zettel (⇧⌘V)"
        >
          <FileText size={14} strokeWidth={1.5} />
          New
        </button>
        <button
          aria-label="Quick Capture"
          className="zettel-hub-action"
          onClick={() => useUIStore.getState().openQuickCapture()}
          title="Quick Capture (⇧⌘N)"
        >
          <Zap size={14} strokeWidth={1.5} />
          Capture
        </button>
        <button
          aria-label="New MOC"
          className="zettel-hub-action"
          onClick={() => getAction("zettelkasten.newMoc")?.()}
          title="New MOC (⇧⌘C)"
        >
          <MapIcon size={14} strokeWidth={1.5} />
          MOC
        </button>
      </div>

      {zettelkastenEnabled && dir ? (
        <>
          <ZettelInboxList
            collapsed={collapsed.inbox}
            items={inbox}
            loading={loading}
            onRefresh={refresh}
            onToggleCollapse={() => toggle("inbox")}
            zettelDir={dir}
          />
          <ZettelSectionList
            collapsed={collapsed.mocs}
            emptyHint="No MOCs yet — tag a note #moc to create one."
            favoriteIds={favoriteIds}
            icon={<MapIcon size={14} strokeWidth={1.5} />}
            items={mocs}
            label="MOCs"
            loading={loading}
            onToggleCollapse={() => toggle("mocs")}
            onToggleFavorite={onToggleFavorite}
          />
          <ZettelSectionList
            collapsed={collapsed.favorites}
            emptyHint="No favorites yet — star a note to pin it here."
            favoriteIds={favoriteIds}
            icon={<Star size={14} strokeWidth={1.5} />}
            items={favorites}
            label="FAVORITES"
            loading={loading}
            onToggleCollapse={() => toggle("favorites")}
            onToggleFavorite={onToggleFavorite}
          />
          <ZettelSectionList
            collapsed={collapsed.recent}
            emptyHint="No notes yet."
            favoriteIds={favoriteIds}
            icon={<Clock size={14} strokeWidth={1.5} />}
            items={recent}
            label="RECENT"
            loading={loading}
            onToggleCollapse={() => toggle("recent")}
            onToggleFavorite={onToggleFavorite}
          />
        </>
      ) : (
        <div className="zettel-hub-hint">
          <p>Set up the Zettel space to start capturing notes.</p>
          <button
            className="zettel-hub-hint-link btn-unstyled"
            onClick={() => useUIStore.getState().toggleSettings()}
          >
            Open Settings
          </button>
        </div>
      )}
    </div>
  );
}
