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
// 카드 자체(`ThemeCard` · `SystemCard`)는 `theme-gallery-cards.tsx` 에 있다.
import { useCallback } from "react";

import type { ThemeSource } from "../../../types/theme-sources";

import { ArrowRight } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { useSettingsStore } from "../../../stores/settings/store";
import { usePluginStore } from "../../../stores/system/plugin";
import { installedThemeDefs } from "../../../themes/installed-theme-defs";
import { themeRevocationFor } from "../../../themes/theme-revocation";
import { BUILT_IN_THEMES } from "../../../types/theme";
import { themeActions } from "../../../types/theme-sources";
import { SystemCard, ThemeCard } from "./theme-gallery-cards";
import { ThemeConsentDialog } from "./ThemeConsentDialog";
import { useThemeActions } from "./use-theme-actions";
import { useThemeFileInstall } from "./use-theme-file-install";
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
  installed: "settings.appearance.groupInstalled",
  custom: "settings.appearance.groupCustom",
  dev: "settings.appearance.groupDev",
};

const GROUPS = Object.entries(GROUP_LABEL_KEYS) as [ThemeSource, string][];

export function ThemeGallery({
  onBrowseThemes,
  onCustomize,
  onExportLook,
}: {
  onBrowseThemes: () => void;
  onCustomize: () => void;
  onExportLook: () => void;
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
  // §361 — owns the source-based branch (custom → deleteCustomTheme, installed →
  // uninstall + removeInstalledTheme) so this component only ever calls `removeTheme`.
  // 이름이 `themeActions` 가 아닌 것은 아래가 부르는 `theme-sources.ts` 의 `themeActions(source)` 를
  // 가리지 않기 위해서다.
  const actions = useThemeActions();
  const {
    handleUpdate,
    installErrors,
    installing,
    pendingConsent,
    removeTheme,
    settleConsent,
    showConsentHistory,
  } = actions;
  // §371 6a — 파일 설치의 동의는 이 화면이 그린다(대화상자 상태의 주인이 위 훅이다).
  const { handleInstallFromFile } = useThemeFileInstall(actions);
  const { handleImport, importError } = useThemeImport(handleInstallFromFile);
  // 스펙 0063 §3.4 — 카드를 고르는 것은 "이 테마의 제안을 다시 받겠다" 다: 거절 기록을 지운다.
  // 제안은 다음 적용부터 다시 닿는다(이번 세션에 손댄 표면은 여전히 건너뛴다, 계획 0111 P1).
  const chooseTheme = useCallback(
    (id: string) => {
      useSettingsStore.getState().clearChromeProposalDeclines(id);
      setActiveTheme(id);
    },
    [setActiveTheme],
  );
  // `useCallback` 인 이유는 `ThemeBrowser.tsx` 의 같은 자리 주석 — 대화상자의 Escape 이펙트가
  // `onCancel` 에 의존한다.
  const onCancelConsent = useCallback(
    () => settleConsent(false),
    [settleConsent],
  );
  const onConfirmConsent = useCallback(
    () => settleConsent(true),
    [settleConsent],
  );
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
      {pendingConsent && (
        <ThemeConsentDialog
          name={pendingConsent.name}
          onCancel={onCancelConsent}
          onConfirm={onConfirmConsent}
        />
      )}
      {GROUPS.map(([source, labelKey]) => {
        const rows = allThemes.filter((theme) => theme.source === source);
        // 빈 제목만 남기지 않는다.
        //
        // ‼️ `installed`는 설치한 테마가 없으면 비고, `dev`는 **언제나** 빈다 — "대개"가
        // 아니다(앞 판의 이 주석이 그렇게 적었다). `src/` 안에서 `ThemeDef.source`에
        // `"dev"`를 넣는 자리가 없기 때문이다(`__tests__` 제외 전수 스캔, 0091 Task 4).
        //
        // ‼️ 세 출처가 내는 값의 근거는 서로 다르다 — `BUILT_IN_THEMES`의 리터럴과
        // `installedThemeToDef`가 박아 넣는 `"installed"`는 **구조적**이지만,
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
              // themeActions(source).consentHistory 는 installed 만 true 다(레지스트리·파일
              // 두 입구 모두 동의를 남긴다, theme-install.ts의 consentedAt 주석). 설치 기록은
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
                  onSelect={chooseTheme}
                  onUpdate={
                    // themeActions(source).update belongs to the `installed` source, and
                    // an entry exists here only when the registry lists a different version
                    // for a theme that came from the registry — `themeUpdatesFor` skips
                    // `origin: "file"` — so the button appears exactly when there is
                    // something to install.
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
        <button className="theme-action-btn" onClick={onExportLook}>
          {t("settings.appearance.exportLook")}
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
