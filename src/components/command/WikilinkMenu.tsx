// §31 Wikilink autocomplete menu — file suggestion popup
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import type { WikilinkSuggestionItem } from "../../extensions/plugins/wikilink-suggest-utils";

import { basename, dirname } from "../../utils/path-utils";

export interface WikilinkMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface WikilinkMenuProps {
  command: (item: WikilinkSuggestionItem) => void;
  items: WikilinkSuggestionItem[];
}

export const WikilinkMenuList = forwardRef<WikilinkMenuRef, WikilinkMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
      new Set(),
    );
    const listRef = useRef<HTMLDivElement>(null);

    // §87 Subfolders start collapsed; root "/" stays expanded.
    // Re-compute when items change (async load).
    useEffect(() => {
      const folders = items
        .filter((i) => i.kind === "folder-header" && i.folder !== "/")
        .map((i) => i.folder!);
      if (folders.length > 0) {
        setCollapsedFolders(new Set(folders));
      }
    }, [items]);

    /**
     * §95 이름이 겹치는 파일 행의 label(소문자 기준) 집합.
     *
     * 설계 §95는 중복 제목을 "폴더/ID/미리보기로 구분"한다고 적었는데, 목록에서
     * ID를 뺀 뒤로 남은 구분 수단이 없다 — 제목이 같은 두 노트는 **글자 하나까지
     * 같은 두 줄**이 되고, 잘못 고른 링크도 `WikilinkView`가 제목으로 렌더하므로
     * 선택 뒤에도 틀렸다는 신호가 없다. 호버 툴팁(`title={item.path}`)은 마우스에만
     * 닿고 이 메뉴는 주로 화살표 키로 훑는다.
     *
     * 겹칠 때만 계산해 붙이는 이유: 대다수 행은 이름이 유일하고, 거기에 폴더까지
     * 그리면 §278 배지가 지키려던 가로 공간을 상시로 잡아먹는다.
     */
    const ambiguousLabels = useMemo(() => {
      const counts = new Map<string, number>();
      for (const i of items) {
        if (!isFileRow(i)) continue;
        const key = i.label.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return new Set(
        [...counts].filter(([, n]) => n > 1).map(([label]) => label),
      );
    }, [items]);

    // §87 Separate selectable items from hint and folder-header items
    const selectableItems = useMemo(
      () =>
        items.filter(
          (i) =>
            i.kind !== "hint" &&
            i.kind !== "folder-header" &&
            !collapsedFolders.has(i.folder ?? ""),
        ),
      [items, collapsedFolders],
    );

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      const container = listRef.current;
      if (!container) return;
      const selected = container.querySelector(".wikilink-item-selected");
      if (selected) {
        selected.scrollIntoView({ block: "nearest" });
      }
    }, [selectedIndex]);

    const selectItem = useCallback(
      (index: number) => {
        const item = selectableItems[index];
        if (item) command(item);
      },
      [selectableItems, command],
    );

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (selectableItems.length === 0) return false;
        if (event.key === "ArrowUp") {
          setSelectedIndex(
            (i) => (i - 1 + selectableItems.length) % selectableItems.length,
          );
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % selectableItems.length);
          return true;
        }
        // ‼️ Tab은 **이 메뉴에서는 도달하지 않는다**. suggestion-renderer는
        // `customOnKeyDown`을 먼저 부르고 `true`면 즉시 반환하는데,
        // wikilink-suggest의 Tab 핸들러는 완성 후보가 없어도 무조건 `true`를
        // 돌려준다(거기서는 Tab이 공통접두 완성 전용이다). 다른 메뉴가 이
        // 컴포넌트를 재사용하게 되면 살아나므로 지우지는 않는다.
        if (event.key === "Enter" || event.key === "Tab") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return <div className="wikilink-menu-empty">No matching pages</div>;
    }

    return (
      <div className="wikilink-menu" ref={listRef}>
        {items.map((item) => {
          if (item.kind === "hint") {
            return (
              <div className="wikilink-menu-hint" key={item.id}>
                <span className="wikilink-hint-label">{item.label}</span>
              </div>
            );
          }
          if (item.kind === "folder-header") {
            const folder = item.folder ?? "/";
            const isCollapsed = collapsedFolders.has(folder);
            const fileCount = items.filter(
              (i) => i.kind !== "folder-header" && i.folder === folder,
            ).length;
            return (
              <div
                className="wikilink-menu-folder-header"
                key={item.id}
                onClick={() =>
                  setCollapsedFolders((prev) => {
                    const next = new Set(prev);
                    if (next.has(folder)) next.delete(folder);
                    else next.add(folder);
                    return next;
                  })
                }
              >
                <span className="wikilink-folder-arrow">
                  {isCollapsed ? "▸" : "▾"}
                </span>
                <span className="wikilink-folder-icon">📁</span>
                <span className="wikilink-folder-name">{item.label}</span>
                <span className="wikilink-folder-count">{fileCount}</span>
              </div>
            );
          }
          // Hide files in collapsed folders
          if (item.folder && collapsedFolders.has(item.folder)) {
            return null;
          }
          const selectableIdx = selectableItems.indexOf(item);
          return (
            <div
              className={`wikilink-menu-item ${selectableIdx === selectedIndex ? "wikilink-item-selected" : ""} ${item.kind === "create" ? "wikilink-item-create" : ""} ${item.folder && item.folder !== "/" ? "wikilink-item-indented" : ""}`}
              key={item.id}
              onClick={() => selectItem(selectableIdx)}
              onMouseEnter={() => setSelectedIndex(selectableIdx)}
              // §278 배지가 못 하는 것을 메운다 — 같은 이름이 다른 폴더에 있을 때는
              // 타입이 같아 배지로 갈리지 않는다. 마우스 사용자에게만 닿는
              // 보조 수단이라, 구분의 **주된** 수단으로 삼지 않는다(배지가 그것이다).
              title={item.path || undefined}
            >
              {item.kind === "create" ? (
                <>
                  <span className="wikilink-item-icon">+</span>
                  <span className="wikilink-item-label">{item.label}</span>
                </>
              ) : item.kind === "heading" ? (
                <>
                  <span className="wikilink-heading-icon">
                    {"#".repeat(item.headingLevel ?? 1)}
                  </span>
                  <span className="wikilink-item-label">{item.heading}</span>
                </>
              ) : (
                <>
                  {/* §95 `label`, not `target` — 제텔 노트는 둘이 다르다(제목 vs ID).
                      설계 §95는 "사용자는 ID를 타이핑/열람하지 않음"이고, 삽입되는
                      문자열은 여전히 `target`이다. 그리는 것과 쓰는 것을 갈라 둔다. */}
                  <span className="wikilink-item-label">{item.label}</span>
                  {/* §95 이름이 겹친 행에만 붙는 상위 폴더. 배지와 같은 이유로
                      flex-shrink:0 — 말줄임이 이름 끝을 먹어도 남아야 한다. */}
                  {ambiguousLabels.has(item.label.toLowerCase()) &&
                    item.path && (
                      <span className="wikilink-item-folder">
                        {basename(dirname(item.path))}
                      </span>
                    )}
                  {/* §278 마크다운이 아닌 항목만 — 배지 없는 줄이 곧 노트다.
                      말줄임이 이름의 끝을 먹어도 타입은 남는다(links.css의
                      flex-shrink:0). PDF와 그 동반 노트는 이름이 같으므로
                      이것이 화면에 남는 유일한 구분 정보다. */}
                  {item.ext && (
                    <span className="wikilink-item-ext">{item.ext}</span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  },
);

WikilinkMenuList.displayName = "WikilinkMenuList";

/** 실제 링크 대상이 되는 행 — 안내 문구·폴더 헤더·Create·heading은 제외한다. */
function isFileRow(item: WikilinkSuggestionItem): boolean {
  return (
    item.kind !== "create" &&
    item.kind !== "folder-header" &&
    item.kind !== "heading" &&
    item.kind !== "hint"
  );
}
