// §371 6a — 외관을 테마로 내보내기(스펙 0062 §4). 지금 보이는 외관 — 입은 테마의 색, 기본값과 다른
// 다이얼, 고르면 숨긴 표시줄 — 을 §360 패키지로 쓴다. 입력은 `appearancePackageInput` 하나가 만들고,
// 요약과 파일이 같은 값을 거친다. 이 화면은 외관 탭의 하위 화면이다(`AppearanceTab.tsx` 의 `SubScreen`).
import { useMemo, useState } from "react";

import { save } from "@tauri-apps/plugin-dialog";

import type { DialId, DialValue } from "../../appearance/dials";
import type { ThemeMode } from "../../types/theme";

import { ArrowLeft } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useEffectiveThemeId } from "../../hooks/use-effective-theme-id";
import { useThemeDials } from "../../hooks/use-theme-dials";
import { useTranslation } from "../../i18n/useTranslation";
import { exportBinaryFile } from "../../ipc/fs";
import { themePackageBuild } from "../../ipc/theme";
import { parseBaramFloor } from "../../plugins/engines";
import { currentAppVersion } from "../../plugins/engines-app";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { appearancePackageInput } from "../../themes/appearance-package";
import { themePackageEntries } from "../../themes/theme-package-export";
import { themeModes } from "../../types/theme";
import { DIAL_LABEL_KEY, dialValueSummary } from "./dial-labels";
import { PackageMetaFields } from "./package-meta-fields";
import { usePackageMeta } from "./use-package-meta";

export function AppearanceExport({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { effectiveThemeId } = useEffectiveThemeId();
  const themeDials = useThemeDials();
  const { appearanceOverrides, customThemes, installedThemes } =
    useSettingsStore(
      useShallow((s) => ({
        appearanceOverrides: s.appearanceOverrides,
        customThemes: s.customThemes,
        installedThemes: s.installedThemes,
      })),
    );
  const chromeVisible = useUIStore(
    useShallow((s) => ({
      activityBar: s.activityBarVisible,
      statusBar: s.statusBarVisible,
      tabBar: s.tabBarVisible,
    })),
  );
  const [includeChrome, setIncludeChrome] = useState(false);
  const [name, setName] = useState("");
  const packageMeta = usePackageMeta(name);

  const input = useMemo(
    () =>
      appearancePackageInput({
        chromeVisible,
        customThemes,
        effectiveThemeId,
        includeChrome,
        installedThemes,
        themeDials,
        userOverrides: appearanceOverrides,
      }),
    [
      appearanceOverrides,
      chromeVisible,
      customThemes,
      effectiveThemeId,
      includeChrome,
      installedThemes,
      themeDials,
    ],
  );

  const modeLabel = (mode: ThemeMode): string =>
    mode === "light" ? t("settings.theme.light") : t("settings.theme.dark");
  const modes = themeModes(input.theme).map(modeLabel).join(" · ");
  const dials = Object.entries(input.dials) as [DialId, DialValue][];
  const surfaceNames = input.hiddenSurfaces
    .map((s) => t(`settings.activitybar.chromeVisibility.${s}`))
    .join(" · ");
  const canExport = packageMeta.complete && name.trim() !== "";

  const handleExport = async () => {
    const showToast = useUIStore.getState().showToast;
    // D5 — 다이얼 · 크롬이 실리면 내보내는 앱의 버전이 하한이다. 모르는 id 를 조용히 버리는 옛 버전
    // (v0.7.4 는 `dials` · `chrome` 전체, v0.7.5 는 본문 타이포 넷)이 설치하지 못하게.
    //
    // ‼️ 하한은 설치하는 쪽이 **읽을 수 있어야** 하한이다. `parseBaramFloor`(`plugins/engines.ts`)는
    // `>=X.Y.Z` 만 읽고, 못 읽는 하한은 "의견 없음" 으로 설치를 통과시킨다 — 프리릴리스 · 빌드
    // 꼬리표가 붙은 앱 버전(`0.8.0-beta.1`)으로 쓴 하한은 옛 버전을 막지 못한다. 그래서 버전을 모를
    // 때와 똑같이 내보내지 않는다.
    let minBaram: string | undefined;
    if (dials.length > 0 || input.chrome !== undefined) {
      const version = await currentAppVersion();
      const floor = version === null ? null : `>=${version}`;
      if (floor === null || parseBaramFloor(floor) === null) {
        showToast(t("settings.appearance.exportLook.versionUnknown"), "error");
        return;
      }
      minBaram = floor;
    }
    const path = await save({
      defaultPath: `${packageMeta.id}.zip`,
      filters: [{ extensions: ["zip"], name: "Baram Theme Package" }],
    });
    if (!path) return;
    const entries = themePackageEntries(
      {
        ...input.theme,
        id: packageMeta.id,
        name: name.trim(),
        source: "custom",
      },
      packageMeta.meta,
      { chrome: input.chrome, dials: input.dials, minBaram },
    );
    // 편집기와 같은 알림 — 색이 없는 모드는 패키지에서 빠진다(`themePackageEntries` 의 규칙).
    const dropped = themeModes(input.theme).filter(
      (m) => !(`${m}/tokens.json` in entries),
    );
    if (dropped.length > 0) {
      showToast(
        t("settings.theme.exportPackageDroppedModes", {
          count: String(dropped.length),
          modes: dropped.map(modeLabel).join(", "),
        }),
        "warning",
      );
    }
    try {
      await exportBinaryFile(path, await themePackageBuild(entries));
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  return (
    <div className="appearance-export">
      <div className="appearance-export-header">
        <button
          className="btn-unstyled appearance-export-back"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft className="icon-inline" size="1em" />{" "}
          {t("settings.appearance.themeBrowser.back")}
        </button>
        <h3 className="appearance-export-title">
          {t("settings.appearance.exportLook.title")}
        </h3>
      </div>

      <ul className="appearance-export-summary">
        <li>
          {input.sourceName === null
            ? t("settings.appearance.exportLook.systemColors", { modes })
            : t("settings.appearance.exportLook.colors", {
                modes,
                name: input.sourceName,
              })}
        </li>
        <li>
          {dials.length === 0
            ? t("settings.appearance.exportLook.noDials")
            : t("settings.appearance.exportLook.dials", {
                count: String(dials.length),
              })}
          {dials.length > 0 && (
            <ul className="appearance-export-dials">
              {dials.map(([id, value]) => (
                <li key={id}>
                  <span>{t(DIAL_LABEL_KEY[id])}</span>{" "}
                  <span className="appearance-export-value">
                    {dialValueSummary(id, value, t)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
        <li>
          <label className="appearance-export-chrome">
            <input
              checked={includeChrome}
              disabled={input.hiddenSurfaces.length === 0}
              onChange={(e) => setIncludeChrome(e.target.checked)}
              type="checkbox"
            />{" "}
            {t("settings.appearance.exportLook.includeChrome")}
          </label>{" "}
          <span className="appearance-export-hint">
            {input.hiddenSurfaces.length === 0
              ? t("settings.appearance.exportLook.noHiddenBars")
              : t("settings.appearance.exportLook.hiddenBars", {
                  bars: surfaceNames,
                })}
          </span>
        </li>
      </ul>
      {input.cssModes.length > 0 && (
        <p className="appearance-export-notice" role="note">
          {t("settings.appearance.exportLook.cssNotice")}
        </p>
      )}

      <input
        aria-label={t("settings.theme.namePlaceholder")}
        className="theme-editor-name"
        onChange={(e) => setName(e.target.value)}
        placeholder={t("settings.theme.namePlaceholder")}
        type="text"
        value={name}
      />
      <PackageMetaFields state={packageMeta} />
      <div className="theme-editor-actions">
        <button
          className="theme-action-btn"
          disabled={!canExport}
          onClick={() => void handleExport()}
          title={
            canExport
              ? undefined
              : t("settings.appearance.exportLook.disabledHint")
          }
          type="button"
        >
          {t("settings.theme.exportPackage")}
        </button>
      </div>
    </div>
  );
}
