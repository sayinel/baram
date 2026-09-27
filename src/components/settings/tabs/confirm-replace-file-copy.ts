// 스펙 0063 §4 — 파일에서 설치한 테마를 레지스트리 패키지로 바꾸기 전에 묻는다.
//
// 파일 입구의 교체 확인(`use-theme-file-install.ts` 의 `confirmReplace` — 레지스트리 설치본을
// 파일로 바꿀 때 "업데이트를 받지 않는다" 를 말한다, 스펙 0062 §5.4)의 거울이다. 이쪽은 반대로
// "이후 업데이트를 받는다" 를 말한다. `use-theme-actions.ts` 가 이미 500줄을 넘어 따로 둔다
// (계획 0111 P7).
import type { Translate } from "../../../i18n/useTranslation";
import type { RegistryEntry } from "../../../plugins/types";
import type { InstalledTheme } from "../../../themes/theme-install";

import { showConfirm } from "../../../utils/confirm-dialog";

export function confirmReplaceFileCopy(
  existing: InstalledTheme,
  entry: RegistryEntry,
  t: Translate,
): Promise<boolean> {
  return showConfirm(
    t("settings.appearance.themeBrowser.replaceFileCopy", {
      from: existing.manifest.version,
      name: existing.manifest.name,
      to: entry.version,
    }),
    {
      cancelLabel: t("common.cancel"),
      confirmLabel: t("settings.appearance.themeBrowser.replace"),
      danger: false,
    },
  );
}
