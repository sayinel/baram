import { useCallback, useRef, useState } from "react";

import type { ActivityBarItemConfig } from "../../../stores/settings-store";

import { useTranslation } from "../../../i18n/useTranslation";
import { useSettingsStore } from "../../../stores/settings-store";
import { SettingsSectionHeader, ToggleSwitch } from "../settings-shared";

export function ActivityBarTab() {
  const { activityBarConfig, setActivityBarConfig, resetActivityBarConfig } =
    useSettingsStore();
  const { t } = useTranslation();

  const [draggingId, setDraggingId] = useState<null | string>(null);
  const [dropIndicator, setDropIndicator] = useState<null | {
    id: string;
    position: "after" | "before";
  }>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragRef = useRef<null | { id: string; section: string }>(null);
  const dropRef = useRef<null | { id: string; position: "after" | "before" }>(
    null,
  );
  const configRef = useRef(activityBarConfig);
  configRef.current = activityBarConfig;

  const topItems = activityBarConfig.filter((i) => i.section === "top");
  const bottomItems = activityBarConfig.filter((i) => i.section === "bottom");

  const toggleItem = (id: string) => {
    setActivityBarConfig(
      activityBarConfig.map((item) =>
        item.id === id ? { ...item, visible: !item.visible } : item,
      ),
    );
  };

  const onPointerDown = useCallback(
    (id: string, section: string, e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { id, section };
      setDraggingId(id);

      const onMove = (moveE: PointerEvent) => {
        const state = dragRef.current;
        if (!state) return;

        let closestId: null | string = null;
        let closestPos: "after" | "before" = "before";
        let closestDist = Infinity;

        for (const [rowId, el] of rowRefs.current.entries()) {
          const rowItem = configRef.current.find((i) => i.id === rowId);
          if (
            !rowItem ||
            rowItem.section !== state.section ||
            rowId === state.id
          )
            continue;

          const rect = el.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const dist = Math.abs(moveE.clientY - midY);

          if (dist < closestDist) {
            closestDist = dist;
            closestId = rowId;
            closestPos = moveE.clientY < midY ? "before" : "after";
          }
        }

        dropRef.current = closestId
          ? { id: closestId, position: closestPos }
          : null;
        setDropIndicator(dropRef.current);
      };

      const onUp = () => {
        const state = dragRef.current;
        const drop = dropRef.current;

        if (state && drop && state.id !== drop.id) {
          const config = [...configRef.current];
          const fromIdx = config.findIndex((i) => i.id === state.id);
          if (fromIdx !== -1) {
            const [item] = config.splice(fromIdx, 1);
            let toIdx = config.findIndex((i) => i.id === drop.id);
            if (toIdx !== -1) {
              if (drop.position === "after") toIdx += 1;
              config.splice(toIdx, 0, item);
              setActivityBarConfig(config);
            }
          }
        }

        dragRef.current = null;
        dropRef.current = null;
        setDraggingId(null);
        setDropIndicator(null);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [setActivityBarConfig],
  );

  const setRowRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const renderSection = (title: string, items: ActivityBarItemConfig[]) => (
    <>
      <SettingsSectionHeader title={title} />
      {items.map((item) => (
        <div
          className={`settings-row activity-bar-config-row${
            draggingId === item.id ? "activity-bar-dragging" : ""
          }${
            dropIndicator?.id === item.id
              ? ` activity-bar-drop-${dropIndicator.position}`
              : ""
          }`}
          key={item.id}
          ref={(el) => setRowRef(item.id, el)}
        >
          <div className="activity-bar-config-left">
            <div
              className="activity-bar-config-drag-handle"
              onPointerDown={(e) => onPointerDown(item.id, item.section, e)}
            >
              {"\u2807"}
            </div>
            <span
              className={`settings-row-label ${!item.visible ? "activity-bar-config-hidden" : ""}`}
            >
              {t(`settings.activitybar.item.${item.id}`)}
            </span>
          </div>
          <div className="settings-row-control">
            <ToggleSwitch
              checked={item.visible}
              onChange={() => toggleItem(item.id)}
            />
          </div>
        </div>
      ))}
    </>
  );

  return (
    <div className="settings-section">
      <div className="settings-row-description" style={{ marginBottom: 12 }}>
        {t("settings.activitybar.desc")}
      </div>
      {renderSection(t("settings.activitybar.sidebarPanels"), topItems)}
      {renderSection(t("settings.activitybar.rightPanels"), bottomItems)}
      <div style={{ marginTop: 16 }}>
        <button className="theme-action-btn" onClick={resetActivityBarConfig}>
          {t("settings.activitybar.resetDefault")}
        </button>
      </div>
    </div>
  );
}
