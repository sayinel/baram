// §54 Theme Editor — color picker editor for customizing themes
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { save } from "@tauri-apps/plugin-dialog";

import type {
  ThemeColorKey,
  ThemeColors,
  ThemeDef,
  ThemeMode,
} from "../../types/theme";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { exportBinaryFile } from "../../ipc/fs";
import { writeFile } from "../../ipc/invoke";
import { themePackageBuild } from "../../ipc/theme";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { lookupThemes } from "../../themes/installed-theme-defs";
import { THEME_ID_RE } from "../../themes/theme-manifest";
import {
  slugifyThemeId,
  themePackageEntries,
} from "../../themes/theme-package-export";
import {
  BUILT_IN_THEMES,
  defaultColorsForBase,
  findThemeById,
  resolveThemeMode,
  THEME_COLOR_KEYS,
  themeModes,
} from "../../types/theme";
import {
  appliesInlineVars,
  applyThemeVars,
  clearThemeVars,
  setThemePreviewOwner,
} from "../../utils/theme-vars";

interface ThemeEditorProps {
  onClose: () => void;
}

export function ThemeEditor({ onClose }: ThemeEditorProps) {
  const { t } = useTranslation();
  const {
    activeThemeId,
    customThemes,
    installedThemes,
    saveCustomTheme,
    setActiveTheme,
  } = useSettingsStore(
    useShallow((s) => ({
      activeThemeId: s.activeThemeId,
      customThemes: s.customThemes,
      installedThemes: s.installedThemes,
      saveCustomTheme: s.saveCustomTheme,
      setActiveTheme: s.setActiveTheme,
    })),
  );

  // The active theme, when it has colours of its own. `system` has none by design,
  // and an id that resolves to nothing means the settings effect cleared the
  // variables too — both editing sessions start from the default-light palette.
  //
  // §361 — `installedThemes` is in this lookup so "Customize" duplicates a COMMUNITY
  // theme's actual colours when one is active, rather than silently falling back to
  // Default Light (`themeActions("community").duplicate` says this path applies to it too).
  const resolvedTheme = useMemo(
    () =>
      activeThemeId === "system"
        ? undefined
        : findThemeById(
            activeThemeId,
            lookupThemes(customThemes, installedThemes),
          ),
    [activeThemeId, customThemes, installedThemes],
  );

  // Resolve the starting theme
  const sourceTheme = useMemo(
    () =>
      resolvedTheme ?? BUILT_IN_THEMES.find((t) => t.id === "default-light")!,
    [resolvedTheme],
  );

  // Local editing state. 편집을 시작할 모드는 출발 테마가 선언한 첫 모드다 —
  // 모드가 없거나 토큰 없이 CSS만 싣는 테마(§358)는 보여줄 색이 없으므로 그
  // 모드의 기본 팔레트에서 출발한다.
  const startMode = themeModes(sourceTheme)[0] ?? "light";
  const [name, setName] = useState(() =>
    sourceTheme.source === "builtin"
      ? `Custom ${sourceTheme.name}`
      : sourceTheme.name,
  );
  const [base, setBase] = useState<ThemeMode>(startMode);
  const [colors, setColors] = useState<ThemeColors>(() => ({
    ...(sourceTheme.modes[startMode]?.colors ??
      defaultColorsForBase(startMode)),
  }));

  // §363 — 배포용 패키지의 매니페스트가 요구하지만 이 편집기는 모르는 값들
  // (`PackageMeta`, theme-package-export.ts). 빈 채로 내보내면 설치되지 않는
  // 패키지가 나온다 — 0091 final review가 잡았듯 이것이 "유일한" 실패 모드는
  // 아니다(색 없는 모드가 조용히 빠지는 것도 별도 실패 모드이고, 아래
  // handleExportPackage의 droppedModes 토스트가 그것을 알린다). 이 값들이
  // 전부 채워지기(그리고 id는 형식도 맞기) 전에는 이 실패 모드 하나만
  // 막으려고 패키지 내보내기 버튼을 비활성한다(canExportPackage).
  const [packageAuthor, setPackageAuthor] = useState("");
  const [packageDescription, setPackageDescription] = useState("");
  const [packageLicense, setPackageLicense] = useState("");
  const [packageVersion, setPackageVersion] = useState("");
  // 0091 fix round 1, Finding 4(MEDIUM 4 판정): 배포 패키지의 id는 저자가
  // 가장 소유해야 하는 필드인데, 예전 코드는 그것을 저자가 보지도 못하는
  // 내부 타임스탬프(`custom-${Date.now()}`)로 정했다. 이름에서 뽑은 기본값을
  // 넣어 두되(slugifyThemeId), 저자가 자유롭게 고칠 수 있는 평범한 입력이다.
  // `name`이 이미 위에서 초기화됐으므로 이 초기값 계산은 그 값을 그대로 읽는다.
  const [packageId, setPackageId] = useState(() => slugifyThemeId(name));
  // 0091 fix round 2, Finding N1(MEDIUM, 재리뷰) — 위 초기값만으로는 부족했다.
  // 빌트인 테마를 열면 id가 예: "custom-default-light"로 채워지는데, 그 뒤
  // name을 "Solar Flare"로 바꿔도 id는 그대로 남는다 — 형식은 여전히
  // 유효하므로 canExportPackage 가드를 그대로 통과해, "Solar Flare"라는
  // 이름의 테마가 아무 경고 없이 custom-default-light라는 id로 나간다. 표준
  // 슬러그 필드 패턴으로 고친다: id 입력을 직접 건드리기 전까지는 name을
  // 따라가고, 한 번 건드리면 더 이상 따라가지 않는다.
  const [packageIdTouched, setPackageIdTouched] = useState(false);
  useEffect(() => {
    if (packageIdTouched) return;
    setPackageId(slugifyThemeId(name));
  }, [name, packageIdTouched]);
  const canExportPackage =
    packageAuthor.trim() !== "" &&
    packageDescription.trim() !== "" &&
    packageLicense.trim() !== "" &&
    packageVersion.trim() !== "" &&
    THEME_ID_RE.test(packageId);

  // Set once the edited colours have been adopted as a real theme, so the unmount
  // cleanup knows there is no preview left to undo. Without it, correctness depends
  // on the cleanup running BEFORE the settings effect re-applies the saved theme —
  // true only while save + close land in one commit (React flushes passive destroys
  // before creates), and silently false the moment the close is deferred.
  const savedRef = useRef(false);

  // ‼️ 이 편집기 인스턴스가 미리보기를 **이미 끝냈는가**. `endPreview` 를 한 번만
  // 실행시키는 관문이고, 그 이유는 Cancel 이 두 번 부르기 때문이다 — 버튼에서 한 번,
  // 그 `onClose()` 가 일으키는 언마운트의 정리에서 한 번(실제 앱의 `onClose` 는
  // 언마운트한다: `tabs/AppearanceTab.tsx` 가 하위 화면을 `null` 로 되돌린다).
  // 관문이 없으면 둘째 호출이 되돌리기를 다시 실행하고, 그때 소유권은 이미 풀려 있어
  // `setThemePreviewOwner(false)` 가 조용히 이른 반환한다 — 재적용 신호가 발화하지
  // 않으므로 그 되돌리기를 고칠 사람이 없다(§367 재리뷰).
  //
  // ‼️ **모듈 전역인 `themePreviewOwned()` 로 판정하면 안 된다.** 편집기가 떠 있는
  // 동안 다른 무언가가 소유권을 놓는 날이 오면 그 술어는 "이미 끝났다" 로 읽혀
  // 되돌리기를 통째로 건너뛰고, 미리보기가 `<html>` 에 박힌 채 남는다. 판정 대상은
  // 문서의 상태가 아니라 **이 인스턴스의 이력**이다.
  const previewEndedRef = useRef(false);

  // Group color keys by category
  const categories = useMemo(() => {
    const map = new Map<string, (typeof THEME_COLOR_KEYS)[number][]>();
    for (const entry of THEME_COLOR_KEYS) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    return map;
  }, []);

  // Apply editing colors to CSS variables in real-time. data-theme도 함께 —
  // 24색 inline vars만 바꾸면 base를 토글해도 <html data-theme>는 이전 값에
  // 머물러, 25키 밖 semantic 토큰·native widget(color-scheme)·CodeMirror가
  // 옛 base로 남은 혼합 미리보기가 됐다(적대 리뷰).
  useEffect(() => {
    const root = document.documentElement;
    applyThemeVars(root, colors, base);
    // 동등성 관문: 이 effect는 색 드래그 틱마다 돈다 — 같은 값이라도
    // setAttribute는 attribute-changed 경로를 타서 셀렉터 재매칭을 유발할
    // 수 있다 (CLAUDE.md의 고빈도 경로 규칙과 같은 이유).
    if (root.dataset.theme !== base) root.dataset.theme = base;
  }, [colors, base]);

  // 편집기가 떠 있는 동안 인라인 변수의 주인은 위 effect다. 그 소유권을 밖에
  // 알려, use-settings-effects의 prefers-color-scheme 리스너가 미리보기를 지우고
  // 저장된 테마를 다시 깔지 않도록 한다 — 왜 그것이 위 주석이 막으려던 혼합
  // 미리보기와 같은 결함인지는 그 리스너 옆에 적혀 있다.
  //
  // ‼️ **되돌리기와 소유권 해제가 한 정리 함수 안에 있고, 그 순서가 계약이다**
  // ({@link endPreview}). 이펙트 둘로 나뉘어 있을 때는 선언 순서가 그 둘을 정렬했고
  // — 해제가 먼저 돌아 테마 이펙트를 다시 돌린 뒤 `restorePreview()` 가 그 결과를
  // 덮었다 — 그래서 강조 다이얼이 옮긴 색이 편집기를 닫는 것만으로 사라졌다
  // (§367 리뷰 I3).
  useEffect(() => {
    setThemePreviewOwner(true);
    // Aliased so the cleanup reads the refs through stable locals (lint rule), not
    // values captured at effect time — both must be read AT cleanup.
    const saved = savedRef;
    const ended = previewEndedRef;
    return () => endPreview(!saved.current, ended);
  }, []);

  const handleColorChange = useCallback((key: ThemeColorKey, value: string) => {
    setColors((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(() => {
    // From here the settings effect owns the DOM: these colours are a real theme.
    savedRef.current = true;
    // ‼️ 부정(`!builtIn`)이 아니라 명시 비교다. 새 모델에는 community·dev도
    // 있고, 그것들을 "내 테마"로 취급하면 편집이 설치본을 덮어쓴다.
    const isCustom = sourceTheme.source === "custom";
    const themeId = isCustom ? sourceTheme.id : `custom-${Date.now()}`;

    // ‼️ 맵을 **합친다**. 통째로 갈아끼우면 쌍(light+dark)을 가진 테마를 편집할 때
    // 편집하지 않은 반대쪽 모드가 경고도 되돌리기도 없이 사라진다 — startMode가
    // themeModes()[0]이라 항상 light에서 출발하므로, 쌍을 가진 테마를 열어 색 하나만
    // 고치고 저장하면 다크 팔레트를 잃는 것이 기본 경로가 된다(계획 0090의 설치
    // 테마가 그런 쌍을 들고 온다). 편집 중인 모드 안쪽도 펼친다.
    //
    // ‼️ **그 안쪽 펼치기가 §358의 `css`를 옮기지는 않는다** — 앞 판의 이 주석은
    // "편집기가 다루지 않는 자산(§358의 css)을 색만 고쳤다는 이유로 떨구지 않는다"고
    // 적었고 그것은 거짓이다(0090 Task 6 실측). `sourceTheme`이 오는
    // `resolvedTheme`(이 파일 위쪽의 `useMemo`)이 `lookupThemes(customThemes,
    // installedThemes)`를 **캐시 인자 없이** 부르므로 `installedThemeToDef`가 모든 모드에 `css: undefined`를 채우고,
    // 이 스프레드는 그 `undefined`를 옮긴다. 즉 CSS를 싣는 설치 테마를 "복제해 편집"하면
    // 색만 있는 사본이 나온다.
    //
    // ‼️ **그런데 그 `lookupThemes` 호출에 캐시를 넘기지 말 것.** 그 누락이 `customThemes`에 테마 CSS
    // 텍스트가 들어가지 못하게 막는 것이고, "위생 파이프라인을 거치지 않은 CSS가 화면에
    // 닿는 경로는 없다"는 §360의 논거가 그 사실에 기댄다(Task 6 리포트의 열거).
    // `customThemes`는 설정 스토어에 영속되고 설치 기록과 짝이 맞지 않으므로, 회수된
    // 설치 테마의 CSS가 사본으로 살아남는 길이 그때 열린다. 복제본이 CSS까지 갖게 하려면
    // 그 사본을 어떻게 검증하고 회수할지를 먼저 정해야 한다 — 0091 이후의 일이다.
    //
    // 부수 효과 하나: 한 모드짜리 테마에서 base 토글을 반대쪽으로 넘겨 저장하면
    // 결과가 쌍이 된다 — 원래 모드는 손대지 않은 원본 팔레트 그대로 남는다.
    const themeDef: ThemeDef = {
      id: themeId,
      name,
      source: "custom",
      modes: {
        ...sourceTheme.modes,
        [base]: { ...sourceTheme.modes[base], colors: { ...colors } },
      },
    };

    saveCustomTheme(themeDef);
    setActiveTheme(themeId);
    onClose();
  }, [
    sourceTheme,
    name,
    base,
    colors,
    saveCustomTheme,
    setActiveTheme,
    onClose,
  ]);

  const handleCancel = useCallback(() => {
    // Restore original colors before closing. 언마운트 정리와 **같은 순서**여야 한다
    // (`endPreview`) — 이 버튼이 두 번째 되돌리기 자리이고, 두 자리가 갈리면 하나만
    // 고치는 날이 온다.
    //
    // ‼️ 여기서 지우고 `onClose()` 에만 맡길 수 없다. 그러면 정확성이 **호출자가
    // 언마운트하는가**에 달리고, 언마운트하지 않는 호출자에게는 Cancel 이 미리보기를
    // 화면에 남긴다(`ThemeEditor` 를 홀로 렌더하는 테스트 넷이 그 경우다). 대신 두 번
    // 불려도 안전하게 만든다 — `previewEndedRef` 가 그 관문이다.
    endPreview(true, previewEndedRef);
    onClose();
  }, [onClose]);

  const handleExport = useCallback(async () => {
    const path = await save({
      filters: [{ name: "JSON", extensions: ["json"] }],
      defaultPath: `${name}.json`,
    });
    if (!path) return;
    const data = JSON.stringify({ name, base, colors }, null, 2);
    await writeFile(path, data);
  }, [name, base, colors]);

  // §363 — 배포 가능한 패키지(zip)를 내보낸다. 위 `handleExport`와는 별개 동작이다
  // (R5): 저것은 `{name, base, colors}`를 쓰고 `use-theme-import.ts`가 오늘도
  // 읽는, 이 앱으로만 되읽는 색 설정이다. 이것은 `baram-theme.json` + 모드별
  // `tokens.json`을 담은 zip이고, 남의 Baram이 설치할 수 있는 패키지다.
  //
  // ‼️ 디렉터리가 아니라 파일 하나를 쓴다(R6) — `exportBinaryFile`은 vault
  // 검사가 없고, 그것이 무해한 이유는 대화상자가 고른 파일 하나만 쓰기
  // 때문이다. 트리를 쓰면 그 전제가 깨진다.
  const handleExportPackage = useCallback(async () => {
    const path = await save({
      filters: [{ name: "Baram Theme Package", extensions: ["zip"] }],
      defaultPath: `${packageId}.zip`,
    });
    if (!path) return;

    // handleSave(§357)와 같은 병합 — 편집 중인 base 모드만 갈아끼우고 나머지
    // 모드는 sourceTheme 그대로 둔다. id는 handleSave의 내부 식별자
    // (isCustom ? sourceTheme.id : `custom-${Date.now()}`)가 아니라 저자가
    // 위에서 고른 packageId다 — 배포 패키지의 id는 저장 스토어의 키가
    // 아니라 남이 설치할 디렉터리 이름이므로 서로 다른 값이어야 맞다.
    const themeDef: ThemeDef = {
      id: packageId,
      name,
      source: "custom",
      modes: {
        ...sourceTheme.modes,
        [base]: { ...sourceTheme.modes[base], colors: { ...colors } },
      },
    };

    const entries = themePackageEntries(themeDef, {
      author: packageAuthor,
      description: packageDescription,
      license: packageLicense,
      version: packageVersion,
    });

    // 0091 fix round 1, Finding 5(MEDIUM) — themePackageEntries가 색 없는
    // 모드를 조용히 건너뛰는 것은 옳지만(파일 헤더의 CSS 논거), 저자에게
    // 알리지 않는 것은 옳지 않다. themePackageEntries 자신은 순수해야
    // 하므로 이 비교는 순수 함수 밖, 호출자인 여기서 한다.
    const declaredModes = themeModes(themeDef);
    const droppedModes = declaredModes.filter(
      (mode) => !(`${mode}/tokens.json` in entries),
    );
    if (droppedModes.length > 0) {
      // 0091 fix round 2, Finding N4(재리뷰) — 새 i18n 키를 만들지 않고
      // 위 base 토글이 이미 쓰는 settings.theme.light/dark를 그대로
      // 쓴다. 같은 패널 안에서 "dark"라는 영문 문자열과 "다크"라는 번역이
      // 동시에 보이면 한 대상에 두 이름이 붙는다.
      const modeLabel = (mode: ThemeMode): string =>
        mode === "light" ? t("settings.theme.light") : t("settings.theme.dark");
      useUIStore.getState().showToast(
        t("settings.theme.exportPackageDroppedModes", {
          count: String(droppedModes.length),
          modes: droppedModes.map(modeLabel).join(", "),
        }),
        "warning",
      );
    }

    // 0091 fix round 1, Finding 7(LOW) — 원래 이 아래는 try/catch가 없었다.
    // themePackageBuild(zip 쓰기 실패)·exportBinaryFile(경로 거부·IO 오류)
    // 모두 reject할 수 있고, async onClick 핸들러 안에서는 처리되지 않은
    // 거부가 사용자에게 아무 표시도 없이 사라진다.
    try {
      const zipBytes = await themePackageBuild(entries);
      await exportBinaryFile(path, zipBytes);
    } catch (err) {
      useUIStore.getState().showToast(String(err), "error");
    }
  }, [
    sourceTheme,
    name,
    base,
    colors,
    packageId,
    packageAuthor,
    packageDescription,
    packageLicense,
    packageVersion,
    t,
  ]);

  return (
    <div className="theme-editor">
      <div className="theme-editor-header">
        <input
          aria-label={t("settings.theme.namePlaceholder")}
          className="theme-editor-name"
          onChange={(e) => setName(e.target.value)}
          placeholder={t("settings.theme.namePlaceholder")}
          type="text"
          value={name}
        />
        <div className="theme-editor-base-toggle">
          <button
            aria-pressed={base === "light"}
            className={`theme-editor-base-btn ${base === "light" ? "theme-editor-base-btn-active" : ""}`}
            onClick={() => setBase("light")}
          >
            {t("settings.theme.light")}
          </button>
          <button
            aria-pressed={base === "dark"}
            className={`theme-editor-base-btn ${base === "dark" ? "theme-editor-base-btn-active" : ""}`}
            onClick={() => setBase("dark")}
          >
            {t("settings.theme.dark")}
          </button>
        </div>
      </div>

      {Array.from(categories.entries()).map(([category, entries]) => (
        <div key={category}>
          <div className="theme-editor-category">{category}</div>
          {entries.map((entry) => (
            <div className="theme-editor-row" key={entry.key}>
              <span className="theme-editor-label">{entry.label}</span>
              {/* 옆의 span은 시각 라벨일 뿐 input과 연결돼 있지 않다 — 스크린
                  리더에는 24개가 전부 무명의 color picker로 읽힌다. */}
              <input
                aria-label={entry.label}
                className="theme-editor-color"
                onChange={(e) => handleColorChange(entry.key, e.target.value)}
                type="color"
                value={colors[entry.key]}
              />
              <span className="theme-editor-hex">{colors[entry.key]}</span>
            </div>
          ))}
        </div>
      ))}

      {/* §363 — 배포용 패키지 매니페스트가 요구하지만 이 편집기가 모르는 값들.
          전부 필수(id는 형식도): 하나라도 비거나 id가 [a-z0-9-] 밖이면
          "패키지로 내보내기" 버튼이 비활성 상태로 남는다(canExportPackage). */}
      <div className="theme-editor-package-meta">
        <input
          aria-label={t("settings.theme.packageAuthorPlaceholder")}
          className="theme-editor-name"
          onChange={(e) => setPackageAuthor(e.target.value)}
          placeholder={t("settings.theme.packageAuthorPlaceholder")}
          type="text"
          value={packageAuthor}
        />
        <input
          aria-label={t("settings.theme.packageDescriptionPlaceholder")}
          className="theme-editor-name"
          onChange={(e) => setPackageDescription(e.target.value)}
          placeholder={t("settings.theme.packageDescriptionPlaceholder")}
          type="text"
          value={packageDescription}
        />
        <input
          aria-label={t("settings.theme.packageIdPlaceholder")}
          className="theme-editor-name"
          onChange={(e) => {
            // 직접 건드리는 순간부터는 name을 더 이상 따라가지 않는다 —
            // 위 useEffect가 packageIdTouched를 보는 이유가 이 한 줄이다.
            setPackageIdTouched(true);
            setPackageId(e.target.value);
          }}
          placeholder={t("settings.theme.packageIdPlaceholder")}
          type="text"
          value={packageId}
        />
        <input
          aria-label={t("settings.theme.packageLicensePlaceholder")}
          className="theme-editor-name"
          onChange={(e) => setPackageLicense(e.target.value)}
          placeholder={t("settings.theme.packageLicensePlaceholder")}
          type="text"
          value={packageLicense}
        />
        <input
          aria-label={t("settings.theme.packageVersionPlaceholder")}
          className="theme-editor-name"
          onChange={(e) => setPackageVersion(e.target.value)}
          placeholder={t("settings.theme.packageVersionPlaceholder")}
          type="text"
          value={packageVersion}
        />
      </div>

      <div className="theme-editor-actions">
        <button className="theme-action-btn" onClick={handleSave}>
          {t("common.save")}
        </button>
        <button className="theme-action-btn" onClick={handleCancel}>
          {t("common.cancel")}
        </button>
        {/* 색 설정만 담는 JSON — use-theme-import.ts가 오늘 되읽는 §355 이전
            포맷(R5). 라이선스·저자 같은 필드가 없어 배포용 패키지가 아니고,
            이 앱 말고는 아무도 설치할 수 없다. */}
        <button className="theme-action-btn" onClick={handleExport}>
          {t("settings.theme.export")}
        </button>
        {/* 배포 가능한 zip. 위 필드가 다 차고 id 형식이 맞을 때까지
            비활성(§363) — 비운 채 내보내면 이 앱조차 설치할 수 없는 패키지가
            나온다(이 버튼이 막는 실패 모드 하나일 뿐 — 색 없는 모드가 빠지는
            것은 별도이고, handleExportPackage의 droppedModes 토스트가 그것을
            알린다). title은 disabled일 때만 이유를 알린다(0091 fix round 1,
            Finding 9 — 예전에는 비활성 상태가 이유 없이 회색이었다). */}
        <button
          className="theme-action-btn"
          disabled={!canExportPackage}
          onClick={handleExportPackage}
          title={
            canExportPackage
              ? undefined
              : t("settings.theme.exportPackageDisabledHint")
          }
        >
          {t("settings.theme.exportPackage")}
        </button>
      </div>
    </div>
  );
}

/**
 * 미리보기를 끝내고 `<html>` 의 주인을 테마 이펙트에 돌려준다.
 *
 * ‼️ **순서가 계약이다.** {@link restorePreview} 는 저장된 팔레트만 알고 **색 다이얼도
 * 테마 CSS 도 모른다** — 그래서 마지막 말은 테마 이펙트가 해야 한다. 소유권을 놓는
 * 것이 그 이펙트를 다시 돌리는 신호이고(`subscribeThemePreviewRelease`,
 * `theme-vars.ts`), 둘의 순서가 뒤집히면 되돌리기가 그 재적용을 덮는다 — §367 리뷰
 * I3 가 실측한 모양이 정확히 그것이다(강조 다이얼을 움직여 둔 채 편집기를 닫으면
 * 이동 없는 강조가 `<html>` 에 남았고, 테마 id·다이얼 값 같은 그 이펙트의 deps 중
 * 하나가 움직일 때까지 그대로였다).
 *
 * `restore` 가 거짓인 자리는 저장 직후다: 그 색은 이제 진짜 테마라 되돌릴 미리보기가
 * 없지만, 소유권은 그때도 놓아야 한다. 저장 경로는 이 함수를 언마운트 정리에서 **한 번**
 * 부르고 그때 소유권을 아직 쥐고 있으므로, 아래 관문에 걸리지 않고 해제까지 간다.
 *
 * ‼️ **한 인스턴스에서 한 번만 실행된다**(`ended`). Cancel 이 이 함수를 두 번 부르기
 * 때문이다 — 버튼에서 한 번, 그 `onClose()` 가 일으키는 언마운트의 정리에서 한 번. 관문이
 * 없으면 둘째 호출이 되돌리기만 다시 실행하고 `setThemePreviewOwner(false)` 는 이미
 * 풀린 소유권 위에서 조용히 이른 반환한다(`theme-vars.ts` 의 `previewOwned === owned`).
 * 그러면 재적용 신호가 발화하지 않아 그 되돌리기를 고칠 사람이 없고, 색 다이얼이 옮긴
 * 강조가 사라진다 — 실측(§367 재리뷰): 언마운트하는 `onClose` 로 Cancel 을 누르면
 * `--color-accent-default` 가 빈 문자열로 끝났다. 관문이 **이 인스턴스의 ref** 인
 * 이유는 호출자 쪽 주석(`previewEndedRef`)이 적는다.
 */
function endPreview(restore: boolean, ended: { current: boolean }): void {
  if (ended.current) return;
  ended.current = true;
  if (restore) restorePreview();
  setThemePreviewOwner(false);
}

/**
 * Undo the live preview the way the settings effect would have applied the theme.
 *
 * ‼️ 이것이 **마지막 작성자가 아니다** — {@link endPreview} 가 이 함수를 부른 뒤
 * 소유권을 놓고, 그 신호를 받은 테마 이펙트가 다시 주장한다. 이 함수가 남아 있는
 * 이유는 그 이펙트가 없는 트리에서도 미리보기가 걷혀야 하기 때문이다(`ThemeEditor`
 * 를 홀로 렌더하는 테스트가 그 경우다).
 *
 * Cascade-only themes (`system`, the two defaults) and an `activeThemeId` that
 * resolves to nothing carry NO inline variables, so restoring them by SETTING the
 * source colours pins a palette that then outranks `prefers-color-scheme` — and the
 * settings effect cannot undo it, since it depends on [activeThemeId, customThemes]
 * and leaving the editor changes neither.
 *
 * Reads the active theme at call time rather than taking a snapshot when the editor
 * opens: a snapshot would restore the PREVIOUS theme's colours over the current one
 * if a theme switch ever became reachable while the editor is open (today the picker
 * is unmounted while editing, so the two agree) — the same defect class this fixes.
 */
function restorePreview(): void {
  const root = document.documentElement;
  const { activeThemeId, customThemes, installedThemes } =
    useSettingsStore.getState();
  const resolved = findThemeById(
    activeThemeId,
    lookupThemes(customThemes, installedThemes),
  );
  // 적용될 모드는 OS 설정이 정한다 — use-settings-effects와 같은 규칙이어야
  // 복원이 그 효과가 남겨둘 상태와 일치한다. 편집 중인 모드는 여기 쓰지 않는다:
  // 그것은 미리보기의 것이고, 복원은 미리보기를 지우는 일이다.
  const mode =
    resolved === undefined
      ? undefined
      : resolveThemeMode(
          resolved,
          window.matchMedia("(prefers-color-scheme: dark)").matches,
        );
  const colors = mode === undefined ? undefined : resolved?.modes[mode]?.colors;
  const hasInlineVars =
    resolved !== undefined && appliesInlineVars(activeThemeId);
  // 색·base·attribute 전부를 호출 시점의 store에서 읽는다(적대 리뷰 2라운드):
  // 편집기를 열 때 캡처한 색을 쓰면, 편집 중 활성 테마가 바뀌는 경로가 생기는
  // 순간 "현재 테마의 base + 과거 테마의 색"이 섞인 복원이 된다. 오늘의 UI는
  // 편집 중 테마 전환을 막지만, 이 함수의 정합성이 그 우연에 기대면 안 된다.
  if (hasInlineVars && mode !== undefined && colors !== undefined) {
    applyThemeVars(root, colors, mode);
  } else {
    clearThemeVars(root);
  }
  // preview effect가 data-theme도 편집 중인 모드로 밀어뒀으므로 attribute까지
  // 되돌린다 — use-settings-effects와 같은 규칙: 해석되는 테마는 그 모드,
  // system·미해석은 attribute 제거(= prefers-color-scheme 경로).
  if (mode !== undefined) {
    root.dataset.theme = mode;
  } else {
    root.removeAttribute("data-theme");
  }
}
