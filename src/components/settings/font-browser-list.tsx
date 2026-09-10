// §352 브라우저 좌측 목록 — 검색·칩으로 걸러진 결과를 Included(번들) ·
// Recent(최근 사용) · Installed(설치됨) 세 그룹으로, 그 순서로 보여준다.
// 각 행은 자기 서체로 자기 이름을 그린다.
import type { Translate } from "../../i18n/useTranslation";
import type { SystemFont } from "../../ipc/types";
import type { FontSlot } from "./FontSlotPicker";

import {
  BASE_EDITOR_STACK,
  BASE_MONO_STACK,
} from "../../utils/editor/font-surfaces";
import { quoteFamily } from "../../utils/editor/quote-font-family";
import { BUNDLED_FONTS } from "../../utils/font/bundled-fonts";

interface Props {
  activeValue: string;
  /** 필터되지 않은 전체 열거 — 최근 항목이 고정폭인지 판정하는 데 필요하다. */
  allFonts: readonly SystemFont[];
  /** 셸이 filterFonts()로 이미 계산한 결과(Installed 그룹의 재료). */
  filtered: readonly SystemFont[];
  loading: boolean;
  onSelect: (name: string) => void;
  query: string;
  recentFonts: readonly string[];
  slot: FontSlot;
  t: Translate;
}

/** 번들 서체는 role로, 그 외는 allFonts의 monospaced 플래그로 판정한다. */
function isMonospacedName(
  name: string,
  allFonts: readonly SystemFont[],
): boolean {
  const key = name.toLowerCase();
  const bundled = BUNDLED_FONTS.find((f) => f.family.toLowerCase() === key);
  if (bundled) return bundled.role === "code";
  return allFonts.some((f) => f.name.toLowerCase() === key && f.monospaced);
}

/** Included → Recent → Installed, 그 순서로 세 그룹을 렌더한다. 빈 그룹은
 * 숨긴다(그룹 헤더만 떠 있는 빈 섹션은 검색이 아무것도 못 찾았다는 뜻으로
 * 오독된다). */
export function FontBrowserList({
  activeValue,
  allFonts,
  filtered,
  loading,
  onSelect,
  query,
  recentFonts,
  slot,
  t,
}: Props) {
  if (loading) {
    return (
      <div
        className="font-browser-list font-browser-list-loading"
        data-testid="font-browser-list-loading"
      >
        {t("settings.editor.fontBrowser.loading")}
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const included = BUNDLED_FONTS.filter(
    (f) => f.role === slot && f.family.toLowerCase().includes(q),
  ).map((f) => f.family);
  const includedKeys = new Set(included.map((n) => n.toLowerCase()));

  const recent = recentForSlot(recentFonts, slot, allFonts, query).filter(
    (name) => !includedKeys.has(name.toLowerCase()),
  );
  const recentKeys = new Set(recent.map((n) => n.toLowerCase()));

  const installed = filtered
    .map((f) => f.name)
    .filter(
      (name) =>
        !includedKeys.has(name.toLowerCase()) &&
        !recentKeys.has(name.toLowerCase()),
    );

  const stack = slot === "code" ? BASE_MONO_STACK : BASE_EDITOR_STACK;
  const empty =
    included.length === 0 && recent.length === 0 && installed.length === 0;

  return (
    <div className="font-browser-list flex-col">
      {empty && (
        <div className="settings-search-empty">
          {t("settings.editor.fontBrowser.empty")}
        </div>
      )}
      {included.length > 0 && (
        <FontGroup
          activeValue={activeValue}
          items={included}
          onSelect={onSelect}
          stack={stack}
          title={t("settings.editor.fontBrowser.groupIncluded")}
        />
      )}
      {recent.length > 0 && (
        <FontGroup
          activeValue={activeValue}
          items={recent}
          itemsTestId="font-browser-recent-items"
          onSelect={onSelect}
          stack={stack}
          title={t("settings.editor.fontBrowser.groupRecent")}
        />
      )}
      {installed.length > 0 && (
        <FontGroup
          activeValue={activeValue}
          items={installed}
          onSelect={onSelect}
          stack={stack}
          title={t("settings.editor.fontBrowser.groupInstalled")}
        />
      )}
    </div>
  );
}

function FontGroup({
  activeValue,
  items,
  itemsTestId,
  onSelect,
  stack,
  title,
}: {
  activeValue: string;
  items: readonly string[];
  itemsTestId?: string;
  onSelect: (name: string) => void;
  stack: string;
  title: string;
}) {
  const active = activeValue.trim().toLowerCase();
  return (
    <div className="font-browser-group">
      <div
        className="font-browser-group-title"
        data-testid="font-browser-group"
      >
        {title}
      </div>
      <div className="font-browser-group-items" data-testid={itemsTestId}>
        {items.map((name) => (
          <FontRow
            active={name.toLowerCase() === active}
            key={name}
            name={name}
            onSelect={onSelect}
            stack={stack}
          />
        ))}
      </div>
    </div>
  );
}

function FontRow({
  active,
  name,
  onSelect,
  stack,
}: {
  active: boolean;
  name: string;
  onSelect: (name: string) => void;
  stack: string;
}) {
  return (
    <button
      aria-pressed={active}
      className={`font-browser-row btn-unstyled text-truncate ${active ? "font-browser-row-active" : ""}`}
      onClick={() => onSelect(name)}
      style={{ fontFamily: `${quoteFamily(name)}, ${stack}` }}
      type="button"
    >
      {name}
    </button>
  );
}

/** 최근 사용 목록을 슬롯으로 좁힌다 — 코드 슬롯에는 고정폭만, 본문 슬롯은
 * 전부. 검색어도 함께 적용해 검색 중에 안 맞는 최근 항목이 섞이지 않게 한다. */
function recentForSlot(
  recentFonts: readonly string[],
  slot: FontSlot,
  allFonts: readonly SystemFont[],
  query: string,
): string[] {
  const q = query.trim().toLowerCase();
  return recentFonts.filter((name) => {
    if (q !== "" && !name.toLowerCase().includes(q)) return false;
    if (slot === "code") return isMonospacedName(name, allFonts);
    return true;
  });
}
