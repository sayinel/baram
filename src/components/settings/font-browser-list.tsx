// §352 브라우저 좌측 목록 — 검색·칩으로 걸러진 결과를 Included(번들) ·
// Recent(최근 사용) · Installed(설치됨) 세 그룹으로, 그 순서로 보여준다.
// 각 행은 자기 서체로 자기 이름을 그린다.
import type { Translate } from "../../i18n/useTranslation";
import type { SystemFont } from "../../ipc/types";
import type { FontListStatus } from "../../utils/font/font-list-state";
import type { FontChip } from "./FontBrowser";
import type { FontSlot } from "./FontSlotPicker";

import {
  BASE_EDITOR_STACK,
  BASE_MONO_STACK,
} from "../../utils/editor/font-surfaces";
import { quoteFamily } from "../../utils/editor/quote-font-family";
import { BUNDLED_FONTS } from "../../utils/font/bundled-fonts";
import { fontAvailability } from "../../utils/font/font-availability";

interface Props {
  activeValue: string;
  /** 필터되지 않은 전체 열거 — 최근 항목이 고정폭·한글인지 판정하는 데 쓴다.
   *
   * ‼️ `status` 가 `ok` 일 때만 "이 머신에 설치됨"의 권위가 있다. `fallback`
   * 이면 이 목록은 그릴 재료일 뿐이므로 가용성 판정에 넘기지 않는다 — 넘기면
   * 실제로 설치된 최근 항목을 "없음"으로 걸러 낸다. */
  allFonts: readonly SystemFont[];
  chips: readonly FontChip[];
  /** 셸이 filterFonts()로 이미 계산한 결과(Installed 그룹의 재료). */
  filtered: readonly SystemFont[];
  onSelect: (name: string) => void;
  query: string;
  recentFonts: readonly string[];
  slot: FontSlot;
  /** 열거의 세 상태 — `fallback` 은 `loading` 과 **다르게** 그린다 (final review I3). */
  status: FontListStatus;
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
  chips,
  filtered,
  onSelect,
  query,
  recentFonts,
  slot,
  status,
  t,
}: Props) {
  if (status === "loading") {
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

  const recent = recentForSlot(
    recentFonts,
    slot,
    allFonts,
    query,
    chips,
    status === "ok",
  ).filter((name) => !includedKeys.has(name.toLowerCase()));
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
      {/* ‼️ The fallback state renders its ROWS, and says so. Before this it
          shared `loading`'s pane, so a machine whose fonts could not be read
          showed "Loading fonts…" forever and FALLBACK_FONTS reached no
          surface at all — §350 required the picker never be empty (final
          review I3). Saying nothing here would be the other failure: rows
          that look like a real, very short enumeration of this machine. */}
      {status === "fallback" && (
        <div
          className="font-browser-list-notice"
          data-testid="font-browser-list-fallback"
        >
          {t("settings.editor.fontBrowser.fallbackNotice")}
        </div>
      )}
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

/**
 * 최근 사용 목록을 좁힌다 — 검색어·칩·슬롯 기본값을 filterFonts()와 같은
 * 규칙으로 적용하고, 더 이상 이 머신에 없는 항목(§346의 결함이 다시 나타나는
 * 자리 — fix round 1 controller ruling)은 제외한다.
 *
 * ‼️ 그 "없음" 판정은 `authoritative`가 참일 때만 한다. 폴백 목록으로
 * `fontAvailability`를 물으면 실제로 설치된 최근 항목이 전부 "missing"으로
 * 나와 Recent 그룹이 통째로 사라진다 — 열거를 못 읽은 것에 대한 벌을 사용자의
 * 이력에 주는 셈이다. `null`을 넘기면 그 판정은 `unknown`이 되어 통과한다.
 */
function recentForSlot(
  recentFonts: readonly string[],
  slot: FontSlot,
  allFonts: readonly SystemFont[],
  query: string,
  chips: readonly FontChip[],
  authoritative: boolean,
): string[] {
  const q = query.trim().toLowerCase();
  const monoDefault = slot === "code" && !chips.includes("all");
  return recentFonts.filter((name) => {
    if (q !== "" && !name.toLowerCase().includes(q)) return false;
    if (fontAvailability(name, authoritative ? allFonts : null) === "missing")
      return false;
    if (monoDefault && !isMonospacedName(name, allFonts)) return false;
    if (chips.includes("korean") && !hasKoreanName(name, allFonts))
      return false;
    if (chips.includes("mono") && !isMonospacedName(name, allFonts))
      return false;
    return true;
  });
}

/** allFonts에서 이름을 찾아 한글 지원 여부를 판정한다. 열거에 없는 이름(번들
 * 서체라 missing으로 걸러지지 않고 살아남았지만 이 머신의 열거에는 없는 경우)
 * 은 판정 불가로 false — 모른다고 한글을 지원한다 주장하지 않는다. */
function hasKoreanName(name: string, allFonts: readonly SystemFont[]): boolean {
  const key = name.toLowerCase();
  return allFonts.some((f) => f.name.toLowerCase() === key && f.hasKorean);
}
