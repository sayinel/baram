// §100/§101 Zettel hub — sidebar panel for the Zettel space.
// Actions bar + Inbox queue + MOCs + Recent sections.
import { useState } from "react";

import { Clock, FileText, Map as MapIcon, Star, Zap } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
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
import { HubTasksSection } from "../tasks/HubTasksSection";
import { useZettelHubData } from "./use-zettel-hub-data";
import { ZettelInboxList } from "./ZettelInboxList";
import { ZettelSectionList } from "./ZettelSectionList";

type CollapseKey = "favorites" | "inbox" | "mocs" | "recent";

export function ZettelHubPanel() {
  const { t } = useTranslation();
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
          aria-label={t("zettel.hub.new.aria")}
          className="zettel-hub-action"
          onClick={() => getAction("zettelkasten.newNote")?.()}
          title={t("zettel.hub.new.title")}
        >
          <FileText size={14} strokeWidth={1.5} />
          {t("zettel.hub.new")}
        </button>
        <button
          aria-label={t("zettel.hub.capture.aria")}
          className="zettel-hub-action"
          onClick={() => useUIStore.getState().openQuickCapture()}
          title={t("zettel.hub.capture.title")}
        >
          <Zap size={14} strokeWidth={1.5} />
          {t("zettel.hub.capture")}
        </button>
        <button
          aria-label={t("zettel.hub.moc.aria")}
          className="zettel-hub-action"
          onClick={() => getAction("zettelkasten.newMoc")?.()}
          title={t("zettel.hub.moc.title")}
        >
          <MapIcon size={14} strokeWidth={1.5} />
          {t("zettel.hub.moc")}
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
            emptyHint={t("zettel.hub.mocs.empty")}
            favoriteIds={favoriteIds}
            icon={<MapIcon size={14} strokeWidth={1.5} />}
            items={mocs}
            label={t("zettel.hub.mocs")}
            loading={loading}
            onToggleCollapse={() => toggle("mocs")}
            onToggleFavorite={onToggleFavorite}
          />
          <ZettelSectionList
            collapsed={collapsed.favorites}
            emptyHint={t("zettel.hub.favorites.empty")}
            favoriteIds={favoriteIds}
            icon={<Star size={14} strokeWidth={1.5} />}
            items={favorites}
            label={t("zettel.hub.favorites")}
            loading={loading}
            onToggleCollapse={() => toggle("favorites")}
            onToggleFavorite={onToggleFavorite}
          />
          <ZettelSectionList
            collapsed={collapsed.recent}
            emptyHint={t("zettel.hub.recent.empty")}
            favoriteIds={favoriteIds}
            icon={<Clock size={14} strokeWidth={1.5} />}
            items={recent}
            label={t("zettel.hub.recent")}
            loading={loading}
            onToggleCollapse={() => toggle("recent")}
            onToggleFavorite={onToggleFavorite}
          />
          {/* §307 C 태스크는 노트가 아니라 조작이라 목록 셋 아래에 둔다 — 위에 두면
              허브를 여는 목적(노트로 들어가기)이 한 칸 밀린다. */}
          <HubTasksSection />
        </>
      ) : (
        <div className="zettel-hub-hint">
          <p>{t("zettel.hub.setup")}</p>
          <button
            className="zettel-hub-hint-link btn-unstyled"
            onClick={() => useUIStore.getState().toggleSettings()}
          >
            {t("zettel.hub.openSettings")}
          </button>
        </div>
      )}
    </div>
  );
}
