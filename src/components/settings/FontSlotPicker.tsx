// §351 설정 행의 서체 슬롯 — 값 · 출처 배지 · 미리보기 스트립 · 브라우저 열기.
//
// 배지가 이 컴포넌트의 존재 이유다. §346까지 드롭다운은 없는 서체를 폴백으로
// 그려서 무효한 항목을 정상처럼 보이게 했다. 스트립은 여전히 폴백으로 렌더되지만
// 배지가 사실을 말한다.
import { useEffect, useRef, useState } from "react";

import type { SystemFont } from "../../ipc/types";
import type { FontAvailability } from "../../utils/font/font-availability";

import { Pencil } from "lucide-react";

import { useTranslation } from "../../i18n/useTranslation";
import {
  BASE_EDITOR_STACK,
  BASE_MONO_STACK,
} from "../../utils/editor/font-surfaces";
import { quoteFamily } from "../../utils/editor/quote-font-family";
import { fontAvailability } from "../../utils/font/font-availability";
import {
  SAMPLE_CODE,
  SAMPLE_EN,
  SAMPLE_GLYPHS,
  SAMPLE_KO,
} from "../../utils/font/font-sample-text";

export type FontSlot = "body" | "code";

/**
 * "unknown"은 배지를 그리지 않는다 — 아직 확인 중이거나 확인할 근거가 없다는
 * 뜻이라, 세 상태(bundled/system/missing) 중 어느 것으로도 단정하면 거짓이
 * 된다(§351 리뷰 Critical 1).
 */
const BADGE_KEY: Record<Exclude<FontAvailability, "unknown">, string> = {
  bundled: "settings.editor.fontPicker.bundled",
  missing: "settings.editor.fontPicker.missing",
  system: "settings.editor.fontPicker.system",
};

/** 배지 색 클래스 — availability 를 문자열로 이어붙이지 않는다: 그러면 클래스
 *  이름 조각이 서체 이름처럼 보이는 리터럴이 되어 i18n 프로즈 스캐너가 걸린다. */
const BADGE_CLASS: Record<Exclude<FontAvailability, "unknown">, string> = {
  bundled: "settings-font-badge-bundled",
  missing: "settings-font-badge-missing",
  system: "settings-font-badge-system",
};

interface Props {
  /** `null` = 아직 단정할 근거가 없다 (로딩 중이거나 열거가 폴백 —
   * `badgeFonts()` 가 두 경우 모두 `null` 로 접는다, final review I3). */
  fonts: null | readonly SystemFont[];
  /** 스트립이 실제 크기로 보여야 판단이 된다 — 같은 화면의 크기·줄높이
   *  슬라이더와 한 값이다. store 를 직접 읽지 않고 받는 이유는 이 컴포넌트가
   *  지금도 순수하게 props 로만 그려지기 때문이다(테스트가 값을 주입한다). */
  fontSize: number;
  lineHeight: number;
  onChange: (family: string) => void;
  onOpenBrowser: (slot: FontSlot) => void;
  slot: FontSlot;
  value: string;
}

export function FontSlotPicker({
  fonts,
  fontSize,
  lineHeight,
  onChange,
  onOpenBrowser,
  slot,
  value,
}: Props) {
  const { t } = useTranslation();
  const availability = fontAvailability(value, fonts);
  const korean = fonts?.find(
    (f) => f.name.toLowerCase() === value.trim().toLowerCase(),
  )?.hasKorean;
  const badge =
    availability === "unknown"
      ? null
      : {
          className: BADGE_CLASS[availability],
          key:
            availability === "system" && korean
              ? "settings.editor.fontPicker.systemKorean"
              : BADGE_KEY[availability],
        };
  const stack = slot === "code" ? BASE_MONO_STACK : BASE_EDITOR_STACK;
  const previewFamily =
    value.trim() === "" ? stack : `${quoteFamily(value)}, ${stack}`;
  const displayValue =
    value.trim() === "" ? t("settings.editor.fontPicker.systemDefault") : value;

  // §351 리뷰 Important 1 — 열거에 없는 이름도 저장 가능해야 한다는 스펙 요건은
  // 자유 입력 없이는 이 UI 어디에도 구현되지 않는다. 그 입구는 연필 버튼이다.
  //
  // 값 이름이 아니다: 이름을 누르면 브라우저가 열린다. 보이는 서체 이름이 눈이
  // 먼저 가는 곳이라 사람들은 그걸 먼저 누르는데, 예전에는 그 클릭이 텍스트
  // 입력으로 바뀌어서 "서체를 고르려던" 의도와 어긋났다. 한 클릭을 두 동작에
  // 나눠 줄 수는 없으므로 드문 쪽(직접 타이핑)이 자기 버튼을 갖는다.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // ‼️ No re-entrancy guard below, and that is a verified absence, not an
  // oversight — a fix-round-1 version of this file HAD one (a
  // `suppressNextBlurRef`), removed here because its own rationale did not
  // hold up (§351 리뷰 fix round 2). Read this before removing the input on
  // Enter/Escape by any means other than conditional unmount.
  //
  // The hazard the old guard was for: Enter/Escape unmount this `<input>`
  // (`editing` flips false). If a native `blur` ever reached this component
  // AFTER that, `commit` would re-run — with `draft` already reset by
  // `cancel()`, silently SAVING the text the user just told the app to
  // discard (worse than Enter's case, which would merely double-commit the
  // same value).
  //
  // It cannot reach here. Two independent reasons, not one:
  //   1. DOM dispatch semantics (real browsers, version-independent): the
  //      HTML spec's unfocusing steps fire `blur` only AFTER the element is
  //      detached (`parentNode === null`). A detached node has no ancestors
  //      to bubble through, so the event never reaches React's
  //      root-delegated listener.
  //   2. jsdom specifically CANNOT exercise this race AT ALL: removing a
  //      focused element moves `document.activeElement` to `<body>`, but
  //      jsdom never fires a native `blur` for it — not synchronously, not
  //      on a later tick, confirmed directly against this repo's jsdom via
  //      both sequential `fireEvent` calls and native events dispatched in
  //      one `act()` batch. A green test that tries to reproduce the race
  //      itself would be proving nothing — this repo's own suite already
  //      did that once and the claim in the report was wrong until
  //      corrected.
  // What IS tested (`FontSlotPicker.test.tsx`) is reason 1's precondition:
  // the input is actually REMOVED from the DOM on Enter/Escape, not merely
  // hidden. A refactor that keeps it mounted and toggles visibility instead
  // reopens a reachable race and fails that test.
  const beginEdit = () => {
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) onChange(trimmed);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  return (
    <div className="settings-font-slot flex-col">
      <div className="settings-font-value">
        {editing ? (
          <input
            className="settings-input settings-font-value-input"
            onBlur={commit}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") cancel();
            }}
            ref={inputRef}
            type="text"
            value={draft}
          />
        ) : (
          <button
            className="settings-font-value-name text-truncate btn-unstyled"
            onClick={() => onOpenBrowser(slot)}
            style={{ fontFamily: previewFamily }}
            type="button"
          >
            {displayValue}
          </button>
        )}
        {badge && (
          <span className={`settings-font-badge ${badge.className}`}>
            {t(badge.key)}
          </span>
        )}
        {!editing && (
          <button
            aria-label={t("settings.editor.fontPicker.edit")}
            className="settings-font-edit icon-btn"
            onClick={beginEdit}
            title={t("settings.editor.fontPicker.edit")}
            type="button"
          >
            <Pencil size={13} />
          </button>
        )}
        <button
          className="settings-font-more"
          onClick={() => onOpenBrowser(slot)}
          type="button"
        >
          {t("settings.editor.fontPicker.more")}
        </button>
      </div>
      <div
        className="settings-font-strip"
        data-testid="font-preview-strip"
        style={{ fontFamily: previewFamily, fontSize, lineHeight }}
      >
        <div className="settings-font-strip-primary text-truncate">
          {slot === "code" ? SAMPLE_CODE : SAMPLE_KO}
        </div>
        <div className="settings-font-strip-secondary text-truncate">
          {SAMPLE_EN}
        </div>
        <div
          className="settings-font-strip-glyphs text-truncate"
          data-testid="font-preview-glyphs"
        >
          {SAMPLE_GLYPHS}
        </div>
      </div>
    </div>
  );
}
