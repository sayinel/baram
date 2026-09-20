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
import type { RevocationEntry } from "../../../plugins/revocation";
import type { ThemeColors, ThemeDef } from "../../../types/theme";
import type { ThemeSource } from "../../../types/theme-sources";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { useSettingsStore } from "../../../stores/settings/store";
import { usePluginStore } from "../../../stores/system/plugin";
import { installedThemeDefs } from "../../../themes/installed-theme-defs";
import { themeRevocationFor } from "../../../themes/theme-revocation";
import { BUILT_IN_THEMES, themeModes } from "../../../types/theme";
import { themeActions } from "../../../types/theme-sources";
import { showConfirm } from "../../../utils/confirm-dialog";
import { PluginRevokedNotice } from "../../plugins/PluginRevokedNotice";
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
  const { handleUpdate, installing, removeTheme, showConsentHistory } =
    useThemeActions();
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
        // dev·community는 대개 비어 있다 — 빈 제목만 남기지 않는다.
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
              return (
                <ThemeCard
                  // 출처가 붙인 배지. 그룹 제목은 보조기기에만 읽히므로, 눈으로
                  // 커스텀을 알아보던 기존 표식은 그대로 둔다.
                  badge={
                    source === "custom"
                      ? t("settings.appearance.customBadge")
                      : undefined
                  }
                  isActive={activeThemeId === theme.id}
                  key={theme.id}
                  onDelete={() => void removeTheme(theme)}
                  onInfo={
                    // themeActions(source).consentHistory 는 community 만 true 다.
                    // installedThemes[theme.id] 는 그래서 항상 있다 — 없으면(이론상
                    // 스토어 불일치) 정보 버튼을 그리지 않는다.
                    themeActions(source).consentHistory &&
                    installedThemes[theme.id]
                      ? () => showConsentHistory(installedThemes[theme.id])
                      : undefined
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
          {t("settings.appearance.browseThemes")}
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
  isActive,
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
  isActive: boolean;
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
  const colors = previewColors(theme);
  const actions = themeActions(theme.source);
  return (
    // 카드와 삭제 버튼은 형제다 — button 안에 button은 HTML이 금지하는 중첩
    // (interactive content)이라 브라우저가 트리를 재구성할 수 있고, 보조기기에는
    // 삭제 버튼이 카드 레이블의 일부로 읽힌다. 겹쳐 보이는 배치는 wrapper의
    // position: relative가 맡는다.
    <div className="theme-card-wrap">
      <button
        aria-pressed={isActive}
        className={`theme-card ${isActive ? "theme-card-active" : ""}`}
        onClick={() => onSelect(theme.id)}
        style={
          isActive && colors
            ? { borderColor: colors["--color-accent-default"] }
            : undefined
        }
      >
        {colors && <ThemeMiniPreview colors={colors} />}
        <span className="theme-card-name">{theme.name}</span>
        {badge !== undefined && (
          <span className="theme-card-badge">{badge}</span>
        )}
      </button>
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
          {"×"}
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
          {"ⓘ"}
        </button>
      )}
    </div>
  );
}

// ─── Theme Mini Preview ─────────────────────────────────

function ThemeMiniPreview({ colors }: { colors: ThemeColors }) {
  const c = colors;
  return (
    // 장식 프리뷰 — 숨기지 않으면 카드 button의 accessible name에 프리뷰의
    // 더미 텍스트(Heading, bold …)까지 전부 섞여 읽힌다(적대 리뷰).
    <div
      aria-hidden="true"
      className="theme-preview"
      style={{ background: c["--color-bg-default"] }}
    >
      <div
        className="theme-preview-sidebar"
        style={{
          background: c["--color-bg-panel"],
          borderRight: `1px solid ${c["--color-border-default"]}`,
        }}
      >
        <div
          className="theme-preview-sidebar-item"
          style={{ background: c["--color-bg-elevated"] }}
        />
        <div
          className="theme-preview-sidebar-item"
          style={{ background: c["--color-bg-elevated"] }}
        />
        <div
          className="theme-preview-sidebar-item"
          style={{ background: c["--color-bg-elevated"] }}
        />
      </div>
      <div
        className="theme-preview-editor"
        style={{ background: c["--color-editor-bg"] }}
      >
        <div
          className="theme-preview-heading"
          style={{ color: c["--color-editor-text"] }}
        >
          Heading
        </div>
        <div
          className="theme-preview-text"
          style={{ color: c["--color-editor-text"] }}
        >
          Some{" "}
          <span style={{ color: c["--color-accent-default"], fontWeight: 600 }}>
            bold
          </span>{" "}
          text
        </div>
        <div
          className="theme-preview-quote"
          style={{
            borderLeft: `2px solid ${c["--color-accent-default"]}`,
            color: c["--color-text-secondary"],
            paddingLeft: 6,
          }}
        >
          blockquote
        </div>
        <div
          className="theme-preview-code"
          style={{
            background: c["--color-bg-elevated"],
            color: c["--color-editor-text"],
          }}
        >
          code
        </div>
      </div>
    </div>
  );
}

// ─── System Card ────────────────────────────────────────

function SystemCard({
  isActive,
  onSelect,
}: {
  isActive: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      aria-pressed={isActive}
      className={`theme-card theme-system-card ${isActive ? "theme-card-active" : ""}`}
      onClick={onSelect}
    >
      {/* 프리뷰는 장식이다 — 숨기지 않으면 카드의 accessible name에
          프리뷰 텍스트("Aa Aa")까지 섞여 읽힌다(적대 리뷰). */}
      <div aria-hidden="true" className="theme-preview theme-preview-split">
        <div className="theme-preview-half" style={{ background: "#ffffff" }}>
          <div
            className="theme-preview-sidebar"
            style={{
              background: "#f5f5f5",
              borderRight: "1px solid #e5e5e5",
            }}
          >
            <div
              className="theme-preview-sidebar-item"
              style={{ background: "#e0e0e0" }}
            />
            <div
              className="theme-preview-sidebar-item"
              style={{ background: "#e0e0e0" }}
            />
          </div>
          <div
            className="theme-preview-editor"
            style={{ background: "#ffffff" }}
          >
            <div
              className="theme-preview-heading"
              style={{ color: "#1a1a1a", fontSize: 7 }}
            >
              Aa
            </div>
          </div>
        </div>
        <div className="theme-preview-half" style={{ background: "#1a1a2e" }}>
          <div
            className="theme-preview-sidebar"
            style={{
              background: "#16213e",
              borderRight: "1px solid #2a2a4a",
            }}
          >
            <div
              className="theme-preview-sidebar-item"
              style={{ background: "#2a2a4a" }}
            />
            <div
              className="theme-preview-sidebar-item"
              style={{ background: "#2a2a4a" }}
            />
          </div>
          <div
            className="theme-preview-editor"
            style={{ background: "#1a1a2e" }}
          >
            <div
              className="theme-preview-heading"
              style={{ color: "#e2e8f0", fontSize: 7 }}
            >
              Aa
            </div>
          </div>
        </div>
      </div>
      <span className="theme-card-name">
        {t("settings.appearance.systemAuto")}
      </span>
    </button>
  );
}

/**
 * 카드가 그릴 팔레트 — 선언된 첫 모드의 것.
 *
 * 미리보기는 정지 화면이라 OS 설정을 따라가지 않는다. 쌍을 가진 테마는
 * 라이트 쪽이 보인다(themeModes가 light를 먼저 돌려준다). 토큰 없이 CSS만
 * 싣는 테마(§358)는 그릴 팔레트가 없으므로 undefined다.
 */
function previewColors(theme: ThemeDef): ThemeColors | undefined {
  const mode = themeModes(theme)[0];
  return mode === undefined ? undefined : theme.modes[mode]?.colors;
}
