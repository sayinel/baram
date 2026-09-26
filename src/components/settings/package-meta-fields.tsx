// §363 · §371 6a — 패키지 정보 다섯 입력. `ThemeEditor.tsx` 의 JSX 를 순서 · 접근 이름 · 클래스째 옮겼다
// — `ThemeEditor.test.tsx` 가 placeholder 로 찾는다.
import type { PackageMetaState } from "./use-package-meta";

import { useTranslation } from "../../i18n/useTranslation";

export function PackageMetaFields({ state }: { state: PackageMetaState }) {
  const { t } = useTranslation();
  return (
    <div className="theme-editor-package-meta">
      <input
        aria-label={t("settings.theme.packageAuthorPlaceholder")}
        className="theme-editor-name"
        onChange={(e) => state.setAuthor(e.target.value)}
        placeholder={t("settings.theme.packageAuthorPlaceholder")}
        type="text"
        value={state.author}
      />
      <input
        aria-label={t("settings.theme.packageDescriptionPlaceholder")}
        className="theme-editor-name"
        onChange={(e) => state.setDescription(e.target.value)}
        placeholder={t("settings.theme.packageDescriptionPlaceholder")}
        type="text"
        value={state.description}
      />
      <input
        aria-label={t("settings.theme.packageIdPlaceholder")}
        className="theme-editor-name"
        onChange={(e) => state.setId(e.target.value)}
        placeholder={t("settings.theme.packageIdPlaceholder")}
        type="text"
        value={state.id}
      />
      <input
        aria-label={t("settings.theme.packageLicensePlaceholder")}
        className="theme-editor-name"
        onChange={(e) => state.setLicense(e.target.value)}
        placeholder={t("settings.theme.packageLicensePlaceholder")}
        type="text"
        value={state.license}
      />
      <input
        aria-label={t("settings.theme.packageVersionPlaceholder")}
        className="theme-editor-name"
        onChange={(e) => state.setVersion(e.target.value)}
        placeholder={t("settings.theme.packageVersionPlaceholder")}
        type="text"
        value={state.version}
      />
    </div>
  );
}
