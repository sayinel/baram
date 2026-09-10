// §352 폰트 브라우저 셸 — 상단 바(뒤로·슬롯 세그먼트·새로 고침) · 검색/칩
// 툴바 · 두 자식(목록·미리보기) 배치와 `filterFonts`만 담는다. 목록 렌더는
// font-browser-list.tsx, 미리보기는 font-browser-preview.tsx가 소유한다.
//
// AppearanceTab의 ThemeEditor와 같은 패턴: 이 컴포넌트가 자기 close를
// 소유하므로 EditorTab은 이 컴포넌트로 탭 바디 전체를 스왑하기만 한다
// (review Important 3 — Browse…가 더 이상 막다른 길이 아니다).
import { useState } from "react";

import type { SystemFont } from "../../ipc/types";
import type { FontSlot } from "./FontSlotPicker";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { listFonts } from "../../ipc/font";
import { useSettingsStore } from "../../stores/settings/store";
import { FontBrowserList } from "./font-browser-list";
import { FontBrowserPreview } from "./font-browser-preview";

export type FontChip = "all" | "korean" | "mono";

interface FilterOptions {
  chips: FontChip[];
  query: string;
  slot: FontSlot;
}

interface FontBrowserProps {
  /** `null` = 아직 신뢰할 수 없다(로딩 중이거나 listFonts()가 폴백으로
   * 떨어짐) — FontSlotPicker의 `fonts`와 같은 계약. */
  fonts: null | SystemFont[];
  onClose: () => void;
  /** §348 최근 사용 서체(슬롯 공용, 최신이 앞) — EditorTab이 store에서 읽어 넘긴다. */
  recentFonts: string[];
  slot: FontSlot;
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
  fonts: SystemFont[],
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
  fonts,
  onClose,
  recentFonts,
  slot,
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
  const [refreshedFonts, setRefreshedFonts] = useState<null | SystemFont[]>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);

  const effectiveFonts = refreshedFonts ?? fonts;
  const filtered =
    effectiveFonts === null
      ? []
      : filterFonts(effectiveFonts, { chips, query, slot: activeSlot });

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
      setRefreshedFonts(result.isFallback ? null : result.fonts);
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
        <span className="font-browser-count" data-testid="font-browser-count">
          {effectiveFonts !== null &&
            t("settings.editor.fontBrowser.count", {
              shown: String(filtered.length),
              total: String(effectiveFonts.length),
            })}
        </span>
      </div>

      <div className="font-browser-body">
        <FontBrowserList
          activeValue={activeSlot === "code" ? codeFontFamily : fontFamily}
          allFonts={effectiveFonts ?? []}
          chips={chips}
          filtered={filtered}
          loading={effectiveFonts === null}
          onSelect={commit}
          query={query}
          recentFonts={recentFonts}
          slot={activeSlot}
          t={t}
        />
        <FontBrowserPreview slot={activeSlot} />
      </div>
    </div>
  );
}
