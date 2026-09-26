// §356 테마 갤러리 — 출처별로 묶인 카드 격자와 그 아래의 갤러리 동작(편집·가져오기).
//
// AppearanceTab에서 나왔다(그 파일이 516줄이었다). 각 그룹은 자기 `.theme-gallery`
// 요소이고 그 클래스가 `grid-template-columns` 와 `margin-bottom: 16px` 을 함께
// 들고 있으므로(`styles/settings/theme.css`), 커스텀 테마가 하나라도 있으면 격자가
// 둘로 **쌓여 보인다**. 의도한 것이다 — 출처별로 나누는 것이 이 변경이 요구받은
// 기능이고, 한 격자 안에서 배지로만 구분하던 것이 그 요구의 출발점이었다. 배지를
// 그대로 둔 이유는 반대편에 있다: 그룹 제목은 aria-label 이라 보조기기에만 읽히므로,
// 그것을 지우면 눈으로 커스텀을 알아보던 유일한 표식이 사라진다.
//
// 카드가 무엇을 할 수 있는지는 themeActions(source)가 정한다. 컴포넌트가
// `source === "builtin"` 같은 비교를 직접 하면 출처가 하나 늘 때 조용히 틀린다.
//
// 카드는 두 열 격자의 세로 카드다(§356) — 위 미리보기(`theme-preview.tsx`), 아래 정보 칸.
// 그림이 읽는 색 키는 `themes/theme-preview-palette.ts` 한 곳에 있다 — 테마 찾아보기
// (`ThemeBrowser.tsx`)가 레지스트리 색인의 팔레트로 같은 그림을 그리게 될 자리다.
import { useId } from "react";
import type { CSSProperties } from "react";

import type { Translate } from "../../../i18n/useTranslation";
import type { RevocationEntry } from "../../../plugins/revocation";
import type { InstalledTheme } from "../../../themes/theme-install";
import type { PreviewPalettes } from "../../../themes/theme-preview-palette";
import type { ThemeDef, ThemeMode } from "../../../types/theme";
import type { ThemeSource } from "../../../types/theme-sources";

import { ArrowRight, Info, X } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { useSettingsStore } from "../../../stores/settings/store";
import { usePluginStore } from "../../../stores/system/plugin";
import { installedThemeDefs } from "../../../themes/installed-theme-defs";
import {
  previewPaletteFrom,
  themePreviewPalettes,
} from "../../../themes/theme-preview-palette";
import { themeRevocationFor } from "../../../themes/theme-revocation";
import { DEFAULT_DARK_PALETTE } from "../../../types/generated/palette-dark";
import { DEFAULT_LIGHT_PALETTE } from "../../../types/generated/palette-light";
import { BUILT_IN_THEMES, themeModes } from "../../../types/theme";
import { themeActions } from "../../../types/theme-sources";
import { showConfirm } from "../../../utils/confirm-dialog";
import { PluginRevokedNotice } from "../../plugins/PluginRevokedNotice";
import { ThemePreview } from "./theme-preview";
import { useThemeActions } from "./use-theme-actions";
import { useThemeImport } from "./use-theme-import";
import { useThemeUpdates } from "./use-theme-updates";

/**
 * 그룹 제목이자 화면에 나오는 순서 — 선언 순서가 곧 표시 순서다.
 *
 * `Record<ThemeSource, …>` 인 것이 요점이다. `theme-sources.ts` 의 `BY_SOURCE` 가
 * 한 약속("새 출처가 생기면 컴파일러가 빠진 행을 짚는다")을 이쪽에서도 지킨다 —
 * 배열이었다면 다섯 번째 출처가 컴파일을 통과하고, 그 출처의 테마만 갤러리에서
 * 조용히 사라졌을 것이다.
 */
const GROUP_LABEL_KEYS: Record<ThemeSource, string> = {
  builtin: "settings.appearance.groupBuiltin",
  community: "settings.appearance.groupInstalled",
  custom: "settings.appearance.groupCustom",
  dev: "settings.appearance.groupDev",
};

const GROUPS = Object.entries(GROUP_LABEL_KEYS) as [ThemeSource, string][];

export function ThemeGallery({
  onBrowseThemes,
  onCustomize,
}: {
  onBrowseThemes: () => void;
  onCustomize: () => void;
}) {
  const { t } = useTranslation();
  const { activeThemeId, customThemes, installedThemes, setActiveTheme } =
    useSettingsStore(
      useShallow((s) => ({
        activeThemeId: s.activeThemeId,
        customThemes: s.customThemes,
        installedThemes: s.installedThemes,
        setActiveTheme: s.setActiveTheme,
      })),
    );
  const { handleImport, importError } = useThemeImport();
  // §361 — owns the source-based branch (custom → deleteCustomTheme, community →
  // uninstall + removeInstalledTheme) so this component only ever calls `removeTheme`.
  const {
    handleUpdate,
    installErrors,
    installing,
    removeTheme,
    showConsentHistory,
  } = useThemeActions();
  const registryUrl = usePluginStore((s) => s.registryUrl);
  const revocations = usePluginStore((s) => s.revocations);
  const { index, updates } = useThemeUpdates();

  const allThemes = [
    ...BUILT_IN_THEMES,
    ...customThemes,
    ...installedThemeDefs(installedThemes),
  ];

  return (
    <>
      {GROUPS.map(([source, labelKey]) => {
        const rows = allThemes.filter((theme) => theme.source === source);
        // 빈 제목만 남기지 않는다.
        //
        // ‼️ `community`는 설치한 테마가 없으면 비고, `dev`는 **언제나** 빈다 — "대개"가
        // 아니다(앞 판의 이 주석이 그렇게 적었다). `src/` 안에서 `ThemeDef.source`에
        // `"dev"`를 넣는 자리가 없기 때문이다(`__tests__` 제외 전수 스캔, 0091 Task 4).
        //
        // ‼️ 세 출처가 내는 값의 근거는 서로 다르다 — `BUILT_IN_THEMES`의 리터럴과
        // `installedThemeToDef`가 박아 넣는 `"community"`는 **구조적**이지만,
        // `customThemes`는 `config.json`에서 되살아나는 `ThemeDef[]`라 타입이 아니라
        // **그 세 writer**(`ThemeEditor`·`useThemeImport`·스토어 마이그레이션)가 `custom`을
        // 쓴다는 사실이 값을 정한다. 손으로 고친 `config.json`은 이 코드베이스가 실제로
        // 상정하는 입력이다(`applyThemeCss`의 주석이 `customThemes[i].modes[mode].css`에
        // 대해 그렇게 따진다). `themeActions`의
        // `reload` 어포던스도 같은 이유로 읽는 쪽이 없다. 둘 다 스펙 §363 §12.2(dev 폴더
        // 로드)가 착지해야 살아난다 — 그 계획은 리로드보다 **로드 경로**를 먼저 설계해야
        // 한다는 것이 0091 이 멈춰서 알아낸 것이다.
        if (rows.length === 0) return null;
        return (
          <div
            aria-label={t(labelKey)}
            className="theme-gallery"
            key={source}
            role="group"
          >
            {source === "builtin" && (
              <SystemCard
                isActive={activeThemeId === "system"}
                onSelect={() => setActiveTheme("system")}
              />
            )}
            {rows.map((theme) => {
              // §361 Task 6 — resolved per card so the notice sits with the theme it is
              // about. Returns null for every built-in and custom row (they have no
              // installed record) without the component needing a `source` comparison.
              const revocation = themeRevocationFor(
                theme.id,
                installedThemes,
                revocations,
              );
              // themeActions(source).consentHistory 는 community 만 true 다. 설치 기록은
              // 그래서 그 출처에서만 읽는다 — id 로만 찾으면 예전 빌드가 남긴 예약 id
              // 기록(`themeRevocationFor` 의 주석)이 같은 이름의 내장 카드에 작성자·설명을
              // 붙인다. 기록이 없으면(이론상 스토어 불일치) 정보 버튼도 설치 정보도 없다.
              const installed = themeActions(source).consentHistory
                ? installedThemes[theme.id]
                : undefined;
              return (
                <ThemeCard
                  // 출처가 붙인 배지. 그룹 제목은 보조기기에만 읽히므로, 눈으로
                  // 커스텀을 알아보던 기존 표식은 그대로 둔다.
                  badge={
                    source === "custom"
                      ? t("settings.appearance.customBadge")
                      : undefined
                  }
                  error={installErrors[theme.id]}
                  isActive={activeThemeId === theme.id}
                  key={theme.id}
                  manifest={installed?.manifest}
                  onDelete={() => void removeTheme(theme)}
                  onInfo={
                    installed ? () => showConsentHistory(installed) : undefined
                  }
                  onSelect={setActiveTheme}
                  onUpdate={
                    // themeActions(source).update is community-only, and an entry only
                    // exists here when the registry lists a different version — so the
                    // button appears exactly when there is something to install.
                    index !== null &&
                    themeActions(source).update &&
                    updates[theme.id]
                      ? () => void handleUpdate(theme.id, index, registryUrl)
                      : undefined
                  }
                  revocation={revocation}
                  theme={theme}
                  updateVersion={updates[theme.id]?.version}
                  updating={installing[theme.id] === true}
                />
              );
            })}
          </div>
        );
      })}

      <div className="theme-actions">
        <button className="theme-action-btn" onClick={onCustomize}>
          {t("settings.appearance.customize")}
        </button>
        <button className="theme-action-btn" onClick={handleImport}>
          {t("settings.appearance.import")}
        </button>
        <button className="theme-action-btn" onClick={onBrowseThemes}>
          {t("settings.appearance.browseThemes")}{" "}
          <ArrowRight className="icon-inline" size="1em" />
        </button>
      </div>
      {importError !== null && (
        <div className="theme-import-error" role="alert">
          {t("settings.appearance.importFailed")}: {importError}
        </div>
      )}
    </>
  );
}

// ─── Theme Card ─────────────────────────────────────────

function ThemeCard({
  badge,
  error,
  isActive,
  manifest,
  onDelete,
  onInfo,
  onSelect,
  onUpdate,
  revocation,
  theme,
  updateVersion,
  updating,
}: {
  badge: string | undefined;
  /**
   * §361 Task 6 fix round 1 (F1) — why an update failure needs a surface HERE.
   *
   * Both of `handleUpdate`'s failure paths write `installErrors[id]` and return false: a
   * withdrawn target, and any `installTheme` refusal. Without this the button read
   * "Updating…" and then went back to offering the same version, saying nothing — which is
   * the state `registry-client.ts` calls "promising an action that cannot succeed" — the
   * sentence immediately BELOW the kind filter this plan added there (an earlier copy of
   * this comment said "three lines above"; the review measured it the other way).
   * `ThemeBrowser.tsx` renders the same map for
   * install, but it holds its OWN `useThemeActions()` instance, so nothing it shows can
   * reach this screen.
   */
  error: string | undefined;
  isActive: boolean;
  /** 레지스트리에서 설치한 테마의 매니페스트 — 작성자 · 버전 · 설명을 정보 칸에 보인다.
   *  내장 · 커스텀 테마는 그 정보가 없어 `undefined` 다. */
  manifest?: InstalledTheme["manifest"];
  onDelete: () => void;
  /** §361 — present only when `themeActions(theme.source).consentHistory` is true AND the
   *  caller has something to show (`theme-gallery.tsx` decides both). */
  onInfo?: () => void;
  onSelect: (id: string) => void;
  /** §361 Task 6 — present only when the registry lists a different version AND
   *  `themeActions(theme.source).update` allows it (`theme-gallery.tsx` decides both). */
  onUpdate?: () => void;
  /** The withdrawal governing this theme, or null. Rendered by `PluginRevokedNotice`,
   *  which itself returns null for `unlisted` — the severity policy stays in that one
   *  component rather than being re-decided per call site. */
  revocation: null | RevocationEntry;
  theme: ThemeDef;
  /** The version {@link onUpdate} would install, for the badge. */
  updateVersion?: string;
  updating: boolean;
}) {
  const { t } = useTranslation();
  const palettes = themePreviewPalettes(theme);
  // 활성 테두리는 그 테마의 강조색 — 쌍이면 라이트 쪽(미리보기 칸 순서와 같다).
  const accent = (palettes.light ?? palettes.dark)?.["--color-accent-default"];
  const actions = themeActions(theme.source);
  return (
    // 카드와 삭제 버튼은 형제다 — button 안에 button은 HTML이 금지하는 중첩
    // (interactive content)이라 브라우저가 트리를 재구성할 수 있고, 보조기기에는
    // 삭제 버튼이 카드 레이블의 일부로 읽힌다. 겹쳐 보이는 배치는 wrapper의
    // position: relative가 맡는다.
    <div className="theme-card-wrap">
      <CardButton
        badge={badge}
        isActive={isActive}
        lines={[
          {
            className: "theme-card-modes",
            text: modesLabel(themeModes(theme), t),
          },
          ...(manifest === undefined
            ? []
            : [
                {
                  className: "theme-card-author",
                  text: `${manifest.author} · v${manifest.version}`,
                },
                {
                  className: "theme-card-description",
                  text: manifest.description,
                },
              ]),
        ]}
        name={theme.name}
        onClick={() => onSelect(theme.id)}
        palettes={palettes}
        style={isActive && accent ? { borderColor: accent } : undefined}
      />
      {onUpdate && updateVersion !== undefined && (
        // The badge and the action are one control, not a badge plus a button: the badge
        // names the version and clicking it installs that version, so there is nothing on
        // screen that announces an update the user cannot act on.
        <button
          aria-label={t("settings.appearance.updateThemeNamed", {
            name: theme.name,
            version: updateVersion,
          })}
          className="theme-card-update"
          disabled={updating}
          onClick={onUpdate}
          title={t("settings.appearance.updateThemeNamed", {
            name: theme.name,
            version: updateVersion,
          })}
        >
          {updating
            ? t("settings.appearance.updatingTheme")
            : t("settings.appearance.updateAvailable", {
                version: updateVersion,
              })}
        </button>
      )}
      {error !== undefined && (
        <div className="theme-card-error" role="alert">
          {error}
        </div>
      )}
      <PluginRevokedNotice
        kind="theme"
        name={theme.name}
        onRemove={actions.remove ? onDelete : undefined}
        revocation={revocation}
      />
      {actions.remove && (
        // 삭제 대상 이름을 accessible name에 포함한다 — 커스텀 테마가
        // 여럿이면 "테마 삭제"만으로는 어느 버튼인지 구분할 수 없다.
        <button
          aria-label={t("settings.appearance.deleteThemeNamed", {
            name: theme.name,
          })}
          className="theme-card-delete"
          // issue 523: a hand-built palette is gone for good on delete,
          // so the click asks first — the same dialog the file tree uses.
          onClick={async () => {
            const confirmed = await showConfirm(
              t("settings.appearance.deleteThemeConfirm", { name: theme.name }),
              {
                cancelLabel: t("common.cancel"),
                confirmLabel: t("common.delete"),
              },
            );
            if (confirmed) onDelete();
          }}
          title={t("settings.appearance.deleteThemeNamed", {
            name: theme.name,
          })}
        >
          <X size={12} />
        </button>
      )}
      {onInfo && (
        // 설치 동의 정보 — §361. 삭제 버튼과 대칭인 반대쪽 모서리에 둔다(같은
        // hover-reveal 방식, `theme-card-wrap`이 기준점).
        <button
          aria-label={t("settings.appearance.consentHistoryLabel", {
            name: theme.name,
          })}
          className="theme-card-info"
          onClick={onInfo}
          title={t("settings.appearance.consentHistoryLabel", {
            name: theme.name,
          })}
        >
          <Info size={12} />
        </button>
      )}
    </div>
  );
}

// ─── Card Button ────────────────────────────────────────

/** 정보 칸의 한 줄 — 클래스가 모양을, 글이 내용을 정한다. */
interface CardLine {
  className: string;
  text: string;
}

/**
 * 테마 카드와 시스템 카드가 함께 쓰는 버튼 뼈대 — 위 미리보기, 아래 정보 칸.
 *
 * 버튼의 **이름**은 테마 이름(+ 커스텀 배지)이고, 정보 칸의 나머지 줄(모드 · 작성자 · 설명)은
 * 버튼의 **설명**이다. 버튼 안의 글을 그대로 이름으로 쓰면 보조기기가 카드마다 긴 문장을
 * 이름으로 읽는다.
 *
 * ‼️ 이름과 설명을 요소 **여럿의 id** 로 모은다(`aria-labelledby` · `aria-describedby`). 한
 * 요소를 가리키면 그 안의 inline span 들이 공백 없이 이어 읽힌다 — 이름과 배지가 붙은
 * span 이던 때 커스텀 테마의 이름은 "MineCustom" 이었다. id 목록은 사이에 공백을 넣는다.
 */
function CardButton({
  badge,
  isActive,
  lines,
  name,
  onClick,
  palettes,
  style,
}: {
  badge?: string;
  isActive: boolean;
  lines: readonly CardLine[];
  name: string;
  onClick: () => void;
  palettes: PreviewPalettes;
  style?: CSSProperties;
}) {
  const id = useId();
  const nameId = `${id}-name`;
  const badgeId = `${id}-badge`;
  const lineIds = lines.map((_, i) => `${id}-line-${i}`);
  return (
    <button
      aria-describedby={lineIds.join(" ")}
      aria-labelledby={badge === undefined ? nameId : `${nameId} ${badgeId}`}
      aria-pressed={isActive}
      className={`theme-card ${isActive ? "theme-card-active" : ""}`}
      onClick={onClick}
      style={style}
    >
      <ThemePreview palettes={palettes} />
      <span className="theme-card-body">
        <span className="theme-card-title">
          <span className="theme-card-name" id={nameId}>
            {name}
          </span>
          {badge !== undefined && (
            <span className="theme-card-badge" id={badgeId}>
              {badge}
            </span>
          )}
        </span>
        {lines.map((line, i) => (
          <span className={line.className} id={lineIds[i]} key={line.className}>
            {line.text}
          </span>
        ))}
      </span>
    </button>
  );
}

/** "라이트 · 다크" — 테마 편집기의 base 토글과 같은 키(`settings.theme.*`)를 쓴다. */
function modesLabel(modes: readonly ThemeMode[], t: Translate): string {
  return modes
    .map((mode) =>
      mode === "light" ? t("settings.theme.light") : t("settings.theme.dark"),
    )
    .join(" · ");
}

// ─── System Card ────────────────────────────────────────

/**
 * 시스템 카드의 그림 — 기본 라이트 · 다크 팔레트.
 *
 * `system` 은 인라인 색을 쓰지 않고 cascade 의 기본값을 입는다(`theme-vars.ts` 의
 * `CASCADE_ONLY_THEME_IDS`). 그 기본값과 이 생성 팔레트는 같은 토큰 파일에서 나오므로, 이
 * 그림이 입었을 때의 화면과 같다. 전에는 손으로 적은 hex 였고 기본 다크 팔레트와 달랐다.
 */
const SYSTEM_PALETTES: PreviewPalettes = {
  dark: previewPaletteFrom(DEFAULT_DARK_PALETTE, "dark"),
  light: previewPaletteFrom(DEFAULT_LIGHT_PALETTE, "light"),
};

function SystemCard({
  isActive,
  onSelect,
}: {
  isActive: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CardButton
      isActive={isActive}
      lines={[
        {
          className: "theme-card-modes",
          text: modesLabel(["light", "dark"], t),
        },
        {
          className: "theme-card-description",
          text: t("settings.appearance.systemAuto.desc"),
        },
      ]}
      name={t("settings.appearance.systemAuto")}
      onClick={onSelect}
      palettes={SYSTEM_PALETTES}
    />
  );
}
