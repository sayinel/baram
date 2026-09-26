// §371 6a — 파일에서 테마 설치(스펙 0062 §5). `테마 가져오기...` 가 고른 패키지는 Rust(`theme_import_pick`)가
// 이미 스테이징했다. 여기서는 관문(예약 id · 하한 · 철회 · 같은 id 교체 확인 · 동의)을 지나 스테이징 이후를
// 레지스트리 설치와 같은 함수(`installStagedThemeFromFile` → `finishStagedThemeInstall`)로 끝낸다.
//
// ‼️ 스테이징된 것은 설치되거나 버려진다. 이 훅이 스스로 멈추는 갈래 여섯(매니페스트 · 예약 id · 하한 ·
// 철회 · 교체 취소 · 동의 거절)은 `stop` 이 버리고, 테스트가 그 여섯 갈래마다 `themeInstallDiscard` 를 본다.
// 그 뒤는 `installStagedThemeFromFile` 의 몫이다 — 성공하면 commit 이 stage 를 가져가고, 실패하면 그 함수가
// 버린다. 빈틈 하나: 동의 상태의 주인(`useThemeActions` 를 부른 화면)이 `askConsent` 를 부르기 **전에**
// 언마운트되면 그 약속은 끝나지 않는다 — 언마운트 정리는 그때 열려 있던 요청만 거절한다. 그 stage 는 다음
// 스테이징이 부르는 `sweep_stale_stages`(`install.rs` — 하루 지난 stage)가 거둔다.
//
// 예약 id · 하한은 동의 **전**에 한 번, `finishStagedThemeInstall` 안에서 한 번 더 본다(계획 0109 P3). 철회는
// 동의 전 여기서 한 번이다 — `finishStagedThemeInstall` 에는 철회 검사가 없다(레지스트리 입구도
// `handleInstall` 의 `refuseIfRevoked` 한 번이다). 여기서 판정하는 id · 버전은 목록의 주장이 아니라 스테이징된
// 매니페스트 자신이고, commit 은 그 원문의 SHA-256(`manifest_sha256`)으로 같은 파일에 묶인다.
//
// 동의 상태(`pendingConsent`)의 주인은 `useThemeActions` 다 — 대화상자를 그리는 화면이 그 훅을 부르므로,
// 이 훅은 그쪽이 돌려주는 `askConsent` · `announceInstalled` 를 받아 쓴다(계획 0109 P4).
import { useCallback } from "react";

import type { ContrastWarning } from "../../../appearance/contrast-report";
import type { Translate } from "../../../i18n/useTranslation";
import type { RustStagedThemeInfo } from "../../../ipc/theme";
import type { InstalledTheme } from "../../../themes/theme-install";
import type { ThemeManifest } from "../../../themes/theme-manifest";

import { useTranslation } from "../../../i18n/useTranslation";
import { themeInstallDiscard } from "../../../ipc/theme";
import { unmetFloorAgainstApp } from "../../../plugins/engines-app";
import { revocationFor, revocationReason } from "../../../plugins/revocation";
import { useSettingsStore } from "../../../stores/settings/store";
import { usePluginStore } from "../../../stores/system/plugin";
import { useThemeCssCacheStore } from "../../../stores/system/theme-css-cache";
import {
  installStagedThemeFromFile,
  parseThemeManifestText,
} from "../../../themes/theme-install";
import { RESERVED_THEME_IDS } from "../../../types/theme";
import { showConfirm } from "../../../utils/confirm-dialog";
import { logger } from "../../../utils/logger";
import { installFailureMessage } from "./use-theme-actions";

export function useThemeFileInstall({
  announceInstalled,
  askConsent,
}: {
  announceInstalled: (
    installed: InstalledTheme,
    warnings: ContrastWarning[],
  ) => void;
  askConsent: (name: string) => Promise<boolean>;
}): {
  handleInstallFromFile: (
    staged: RustStagedThemeInfo,
    fileName: string,
  ) => Promise<null | string>;
} {
  const { t } = useTranslation();
  const revocations = usePluginStore((s) => s.revocations);
  const clearThemeCssCache = useThemeCssCacheStore((s) => s.clearTheme);

  /** 사용자에게 보일 문구를 돌려준다. `null` 은 "말할 것 없음"(성공 또는 사용자가 멈춤). */
  const handleInstallFromFile = useCallback(
    async (
      staged: RustStagedThemeInfo,
      fileName: string,
    ): Promise<null | string> => {
      const stop = async (message: null | string): Promise<null | string> => {
        try {
          await themeInstallDiscard(staged.stage_id);
        } catch (err) {
          logger.error(
            "[Theme] discarding the staged file install failed:",
            err,
          );
        }
        return message;
      };

      const parsed = parseThemeManifestText(staged.manifest);
      if (!parsed.valid) {
        logger.error("[Theme] file install: manifest invalid", parsed.errors);
        return stop(t("settings.appearance.installError.manifestInvalid"));
      }
      const { manifest } = parsed;
      if (RESERVED_THEME_IDS.has(manifest.id)) {
        return stop(
          t("settings.appearance.installError.reservedId", { id: manifest.id }),
        );
      }
      const unmet = await unmetFloorAgainstApp(manifest.engines);
      if (unmet !== null) {
        return stop(
          t("settings.appearance.installError.appTooOld", {
            current: unmet.appVersion,
            required: unmet.floor,
          }),
        );
      }
      // §69 — 새로 들이는 것은 철회의 심각도와 무관하게 거부한다(`use-theme-actions.ts` 의 `refuseIfRevoked`).
      const blocked = revocationFor(manifest.id, manifest.version, revocations);
      if (blocked !== null) {
        return stop(
          `${t("plugin.revoked.blockedInstall")} ${revocationReason(blocked, t)}`,
        );
      }
      const existing = useSettingsStore.getState().installedThemes[manifest.id];
      if (
        existing !== undefined &&
        !(await confirmReplace(existing, manifest, t))
      ) {
        return stop(null);
      }
      if (!(await askConsent(`${manifest.name} — ${fileName}`))) {
        return stop(null);
      }

      const result = await installStagedThemeFromFile(staged);
      if (!result.ok) {
        logger.error(
          "[Theme] file install failed:",
          result.reason,
          result.detail,
          result.errors,
        );
        return installFailureMessage(result, t);
      }
      // ‼️ `freshConsent` — 이 경로는 방금 물었다(`handleInstall` 과 같은 이유, 0090 final review N2).
      useSettingsStore
        .getState()
        .addInstalledTheme(result.installed, { freshConsent: true });
      clearThemeCssCache(result.installed.id);
      announceInstalled(result.installed, result.warnings ?? []);
      return null;
    },
    [announceInstalled, askConsent, clearThemeCssCache, revocations, t],
  );

  return { handleInstallFromFile };
}

/** 같은 id 가 이미 설치돼 있다 — 출처에 따라 무엇을 잃는지 말하고 확인받는다(스펙 0062 §5.4). */
function confirmReplace(
  existing: InstalledTheme,
  incoming: ThemeManifest,
  t: Translate,
): Promise<boolean> {
  const message =
    existing.origin === "file"
      ? t("settings.appearance.installFromFile.replaceFile", {
          from: existing.manifest.version,
          name: existing.manifest.name,
          to: incoming.version,
        })
      : t("settings.appearance.installFromFile.replaceRegistry", {
          name: existing.manifest.name,
        });
  return showConfirm(message, {
    cancelLabel: t("common.cancel"),
    confirmLabel: t("settings.appearance.installFromFile.replace"),
    danger: false,
  });
}
