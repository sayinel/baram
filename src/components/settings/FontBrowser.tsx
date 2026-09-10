// §352 폰트 브라우저 셸 — 상단 바(뒤로·슬롯 세그먼트·새로 고침) · 검색/칩
// 툴바 · 두 자식(목록·미리보기) 배치와 `filterFonts`만 담는다. 목록 렌더는
// font-browser-list.tsx, 미리보기는 font-browser-preview.tsx가 소유한다.
//
// AppearanceTab의 ThemeEditor와 같은 패턴: 이 컴포넌트가 자기 close를
// 소유하므로 EditorTab은 이 컴포넌트로 탭 바디 전체를 스왑하기만 한다
// (review Important 3 — Browse…가 더 이상 막다른 길이 아니다).
import { useState } from "react";

import type { SystemFont } from "../../ipc/types";
import type { FontListState } from "../../utils/font/font-list-state";
import type { FontSlot } from "./FontSlotPicker";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { listFonts } from "../../ipc/font";
import { useSettingsStore } from "../../stores/settings/store";
import { fontListStateFrom } from "../../utils/font/font-list-state";
import { FontBrowserList } from "./font-browser-list";
import { FontBrowserPreview } from "./font-browser-preview";

export type FontChip = "all" | "korean" | "mono";

interface FilterOptions {
  chips: FontChip[];
  query: string;
  slot: FontSlot;
}

interface FontBrowserProps {
  onClose: () => void;
  /** §348 최근 사용 서체(슬롯 공용, 최신이 앞) — EditorTab이 store에서 읽어 넘긴다. */
  recentFonts: string[];
  slot: FontSlot;
  /**
   * 열거의 세 상태 (`font-list-state.ts`).
   *
   * ‼️ 여기서 `fallback` 을 `loading` 으로 접지 않는다 — 그 접기가 열거 실패 시
   * 목록 창을 영구히 "불러오는 중"으로 만들었고 §350 의 "피커가 비는 일은 없어야
   * 한다"를 무효화했다(final review I3). 배지가 폴백에 단정하지 않는 것과, 목록이
   * 폴백을 **보여주는** 것은 양립한다.
   */
  state: FontListState;
}

/**
 * 칩은 교집합이다.
 *
 * 합집합이면 "한글 + 고정폭"이 한글 서체 전부를 돌려주어 좁히는 도구가 넓히는
 * 도구가 된다. 사용자는 칩을 더 누를수록 목록이 줄어들기를 기대한다.
 *
 * 코드 슬롯은 `mono`를 기본으로 켠 것처럼 동작하되, `all` 칩으로 해제할 수
 * 있다 — 비례 서체를 코드에 쓰는 것은 이상하지만 금지할 일은 아니다.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function filterFonts(
  fonts: readonly SystemFont[],
  opts: FilterOptions,
): SystemFont[] {
  const q = opts.query.trim().toLowerCase();
  const monoDefault = opts.slot === "code" && !opts.chips.includes("all");
  return fonts.filter((f) => {
    if (q !== "" && !f.name.toLowerCase().includes(q)) return false;
    if (monoDefault && !f.monospaced) return false;
    if (opts.chips.includes("korean") && !f.hasKorean) return false;
    if (opts.chips.includes("mono") && !f.monospaced) return false;
    return true;
  });
}

export function FontBrowser({
  onClose,
  recentFonts,
  slot,
  state,
}: FontBrowserProps) {
  const { t } = useTranslation();
  const {
    codeFontFamily,
    fontFamily,
    pushRecentFont,
    setCodeFontFamily,
    setFontFamily,
  } = useSettingsStore(
    useShallow((s) => ({
      codeFontFamily: s.codeFontFamily,
      fontFamily: s.fontFamily,
      pushRecentFont: s.pushRecentFont,
      setCodeFontFamily: s.setCodeFontFamily,
      setFontFamily: s.setFontFamily,
    })),
  );

  const [activeSlot, setActiveSlot] = useState<FontSlot>(slot);
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<FontChip[]>([]);
  // `null` here means one thing only — "refresh has not been used" — so the
  // `??` below is not the conflation `fonts`/`null` used to be: a refresh that
  // FAILS now lands as a `fallback` state and is rendered as one, instead of
  // silently reusing the previous list (final review I3).
  const [refreshed, setRefreshed] = useState<FontListState | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const effective = refreshed ?? state;
  const filtered =
    effective.status === "loading"
      ? []
      : filterFonts(effective.fonts, { chips, query, slot: activeSlot });

  // 슬롯을 바꾸면 칩도 초기화한다 — "all"은 코드 슬롯 전용 해제 스위치라
  // 본문 슬롯으로 넘어간 채 남아 있으면 아무 뜻도 없는 상태가 된다.
  const switchSlot = (next: FontSlot) => {
    setActiveSlot(next);
    setChips([]);
  };

  const toggleKorean = () => {
    setChips((prev) =>
      prev.includes("korean")
        ? prev.filter((c) => c !== "korean")
        : [...prev, "korean"],
    );
  };

  // 코드 슬롯은 고정폭이 암묵적 기본값이다 — 이 칩은 그 기본값을 "all"로
  // 해제/복원하는 스위치로 동작한다. 본문 슬롯에서는 평범한 `mono` 칩이다.
  const toggleMono = () => {
    if (activeSlot === "code") {
      setChips((prev) =>
        prev.includes("all")
          ? prev.filter((c) => c !== "all")
          : [...prev, "all"],
      );
    } else {
      setChips((prev) =>
        prev.includes("mono")
          ? prev.filter((c) => c !== "mono")
          : [...prev, "mono"],
      );
    }
  };
  const monoActive =
    activeSlot === "code" ? !chips.includes("all") : chips.includes("mono");

  const commit = (name: string) => {
    if (activeSlot === "code") setCodeFontFamily(name);
    else setFontFamily(name);
    pushRecentFont(name);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    void listFonts(true).then((result) => {
      setRefreshed(fontListStateFrom(result));
      setRefreshing(false);
    });
  };

  return (
    <div className="font-browser flex-col">
      <div className="font-browser-topbar flex-header">
        <button
          className="font-browser-back btn-unstyled"
          onClick={onClose}
          type="button"
        >
          {"← "}
          {t("settings.editor.fontBrowser.back")}
        </button>
        <div className="font-browser-slot-group">
          <button
            aria-pressed={activeSlot === "body"}
            className={`font-browser-slot-btn ${activeSlot === "body" ? "font-browser-slot-btn-active" : ""}`}
            onClick={() => switchSlot("body")}
            type="button"
          >
            {t("settings.editor.fontBrowser.slotBody")}
          </button>
          <button
            aria-pressed={activeSlot === "code"}
            className={`font-browser-slot-btn ${activeSlot === "code" ? "font-browser-slot-btn-active" : ""}`}
            onClick={() => switchSlot("code")}
            type="button"
          >
            {t("settings.editor.fontBrowser.slotCode")}
          </button>
        </div>
        <button
          className="settings-model-refresh"
          disabled={refreshing}
          onClick={handleRefresh}
          type="button"
        >
          {refreshing ? (
            <span className="settings-model-spinner" />
          ) : (
            t("settings.editor.fontBrowser.refresh")
          )}
        </button>
      </div>

      <div className="font-browser-toolbar">
        <div className="settings-search-wrapper">
          <input
            className="settings-search"
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.editor.fontBrowser.searchPlaceholder")}
            spellCheck={false}
            type="text"
            value={query}
          />
          {query && (
            <button
              className="settings-search-clear"
              onClick={() => setQuery("")}
              type="button"
            >
              {"×"}
            </button>
          )}
        </div>
        <div className="font-browser-chips">
          <button
            aria-pressed={chips.includes("korean")}
            className={`font-browser-chip ${chips.includes("korean") ? "font-browser-chip-active" : ""}`}
            onClick={toggleKorean}
            type="button"
          >
            {t("settings.editor.fontBrowser.chipKorean")}
          </button>
          <button
            aria-pressed={monoActive}
            className={`font-browser-chip ${monoActive ? "font-browser-chip-active" : ""}`}
            onClick={toggleMono}
            type="button"
          >
            {t("settings.editor.fontBrowser.chipMono")}
          </button>
        </div>
        {/* `ok` only. A count over the fallback list reads as "this machine
            has 5 fonts", which is the claim the fallback state exists to
            avoid making; the list pane's notice says what is going on
            instead. */}
        <span className="font-browser-count" data-testid="font-browser-count">
          {effective.status === "ok" &&
            t("settings.editor.fontBrowser.count", {
              shown: String(filtered.length),
              total: String(effective.fonts.length),
            })}
        </span>
      </div>

      <div className="font-browser-body">
        <FontBrowserList
          activeValue={activeSlot === "code" ? codeFontFamily : fontFamily}
          allFonts={effective.status === "loading" ? [] : effective.fonts}
          chips={chips}
          filtered={filtered}
          onSelect={commit}
          query={query}
          recentFonts={recentFonts}
          slot={activeSlot}
          status={effective.status}
          t={t}
        />
        <FontBrowserPreview slot={activeSlot} />
      </div>
    </div>
  );
}
