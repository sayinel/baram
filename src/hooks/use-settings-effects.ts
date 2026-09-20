// §4.2 Settings effects hook — apply theme, font, spellcheck to DOM
import { useEffect } from "react";

import type { FeatureKey } from "../stores/settings/feature-keys";
import type { Editor } from "@tiptap/core";

import { useShallow } from "zustand/shallow";

import { useFeatureFlags } from "../stores/settings/features";
import { useSettingsStore } from "../stores/settings/store";
import { useThemeCssCacheStore } from "../stores/system/theme-css-cache";
import {
  RIGHT_PANEL_MODE_FEATURE,
  SIDEBAR_PANEL_FEATURE,
} from "../stores/ui/panel-feature";
import { useUIStore } from "../stores/ui/ui";
import { lookupThemes } from "../themes/installed-theme-defs";
import { findThemeById, resolveThemeMode } from "../types/theme";
import { applyFontVariables } from "../utils/editor/font-surfaces";
import { resolveCodeMetrics } from "../utils/font/code-metrics";
import { logger } from "../utils/logger";
import {
  appliesInlineVars,
  applyThemeCss,
  applyThemeVars,
  clearThemeVars,
  themePreviewOwned,
} from "../utils/theme-vars";
import { useThemeCssHydration } from "./use-theme-css-hydration";

export function useSettingsEffects(editor: Editor | null) {
  const {
    activeThemeId,
    codeFontFamily,
    codeFontSize,
    codeLineHeight,
    customThemes,
    installedThemes,
    fontSize,
    fontFamily,
    lineHeight,
    linkFontMetrics,
    spellCheck,
    editorMaxWidth,
  } = useSettingsStore(
    useShallow((s) => ({
      activeThemeId: s.activeThemeId,
      codeFontFamily: s.codeFontFamily,
      codeFontSize: s.codeFontSize,
      codeLineHeight: s.codeLineHeight,
      customThemes: s.customThemes,
      installedThemes: s.installedThemes,
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      lineHeight: s.lineHeight,
      linkFontMetrics: s.linkFontMetrics,
      spellCheck: s.spellCheck,
      editorMaxWidth: s.editorMaxWidth,
    })),
  );
  // §361 — a community theme's CSS text is not in the settings store (only a `css: boolean`
  // flag is; see `InstalledTheme`'s doc comment), so it has to be re-read off disk. This
  // hook does that re-read and drops the result in `useThemeCssCacheStore`, which the apply
  // effect below reads via `cssCacheEntries`.
  useThemeCssHydration(activeThemeId, installedThemes);
  const cssCacheEntries = useThemeCssCacheStore((s) => s.entries);

  useEffect(() => {
    const root = document.documentElement;
    // ‼️ 신설이다. 지금까지 `system` 은 인라인 변수를 아예 쓰지 않고 cascade 에만
    // 의존했으므로(CASCADE_ONLY_THEME_IDS) OS 전환을 들을 이유가 없었다. 쌍을 가진
    // 설치 테마는 인라인 토큰을 쓰므로 전환 시 다시 써야 한다 — 미디어 쿼리는
    // 인라인 스타일을 바꿔 주지 않는다.
    const mql = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      // Clear previous CSS variable overrides
      clearThemeVars(root);

      // ‼️ §358 이른 반환 셋을 걷어냈다(이제 이 함수에는 반환이 없다). 적용물이 인라인
      // 변수 하나였을 때는 맨 위의 clearThemeVars 가 모든 갈래를 덮었지만, 이제 `<style>`
      // 도 갈린다 — 갈래마다 제거를 따로 적으면 그중 하나를 빠뜨리는 날 앞 테마의 CSS 가
      // 남는다. 그것이 #330 의 모양이다. 그래서 `data-theme` 도 `applyThemeCss` 도
      // 아래 한 자리에서만 결정된다.
      const themeDef =
        activeThemeId === "system"
          ? undefined
          : findThemeById(
              activeThemeId,
              lookupThemes(customThemes, installedThemes, cssCacheEntries),
            );
      const mode =
        themeDef === undefined
          ? undefined
          : resolveThemeMode(themeDef, mql.matches);

      // Set the mode (light/dark) for CSS + CodeMirror.
      // ‼️ NOT Mermaid any more — it renders in one fixed palette regardless
      // (MERMAID_THEME in utils/markdown/mermaid-utils.ts), because its colours
      // are baked into the SVG and would follow the editor's theme into a PDF.
      if (mode === undefined) root.removeAttribute("data-theme");
      else root.dataset.theme = mode;

      const assets =
        themeDef === undefined || mode === undefined
          ? undefined
          : themeDef.modes[mode];

      // For non-default themes, apply CSS variable overrides. The default themes
      // need none: src/styles/generated/ already carries their values, including the
      // accent pairing that applyThemeVars derives for everyone else (#330).
      const colors = assets?.colors;
      if (
        mode !== undefined &&
        appliesInlineVars(activeThemeId) &&
        colors !== undefined
      ) {
        applyThemeVars(root, colors, mode);
      }

      // §358 스펙 §6 의 순서 — generated → 토큰 → CSS. 테마 CSS 가 마지막인 이유는
      // 그것이 토큰을 읽는 쪽이기 때문이다. 저장된 바이트가 계약을 지키는지는
      // applyThemeCss 가 주입 직전에 다시 본다(설치 때 통과한 사실을 믿지 않는다).
      applyThemeCss(document, assets?.css);
    };

    apply();
    // ‼️ 테마 편집기가 열려 있는 동안에는 OS 전환을 **듣기만 하고 적용하지 않는다**.
    // apply()의 첫 줄이 clearThemeVars이므로, 색을 드래그하는 중에 해가 져서 macOS가
    // 다크로 넘어가면 미리보기가 지워지고 저장된 테마가 다시 깔린다 — ThemeEditor의
    // preview effect는 deps가 [colors, base]라 다시 돌지 않으므로 hex 스와치가 화면에
    // 없는 색을 설명하게 되고, 더 나쁘게는 data-theme이 **저장된** 테마의 모드로
    // 되돌아간다. 그것은 ThemeEditor.tsx의 preview effect 주석("…옛 base로 남은 혼합
    // 미리보기", 현재 :100-103)이 막으려고 쓴 결함이 새 문으로 되살아난 것이다.
    // 건너뛴 전환은 잃지 않는다: 편집기를 닫으면 restorePreview()가, 저장하면 이
    // 이펙트의 재실행이 각각 그 시점의 mql.matches를 다시 읽는다.
    const onSchemeChange = () => {
      if (themePreviewOwned()) return;
      apply();
    };
    mql.addEventListener("change", onSchemeChange);
    return () => mql.removeEventListener("change", onSchemeChange);
    // §361 — `installedThemes`/`cssCacheEntries` added: a community theme's CSS arrives
    // AFTER this effect's first run (the hydration hook above fetches it asynchronously),
    // so the effect has to re-run once the cache fills in, or the theme stays colour-only
    // until something else happens to change activeThemeId/customThemes.
  }, [activeThemeId, customThemes, installedThemes, cssCacheEntries]);

  useEffect(() => {
    // §perf-large-file C3.4: resolve via editor.view.dom rather than a global
    // querySelector so this targets the ACTIVE editor in a dual-editor layout.
    const domNode: Element | null = editor ? editor.view.dom : null;
    if (!domNode) return;
    const tiptap = domNode as HTMLElement;
    // eslint-disable-next-line react-hooks/immutability -- we are styling the DOM element, not mutating the editor argument
    tiptap.style.fontSize = `${fontSize}px`;
    // §349 인라인 font-family 대신 변수 두 개. 인라인은 이 요소의 `font-family`
    // 하나만 덮으므로 코드·수식·표·미디어가 읽는 var(--font-family-mono) 소비자
    // 들에는 닿지 않았고, 그래서 "코드 서체"라는 설정이 존재할 수 없었다.
    //
    // ‼️ 변수 상속의 범위는 DOM 포함관계이지 파일 경로가 아니다 — `.tiptap` 밖으로
    // 포털되는 오버레이는 이 한 줄로 따라오지 **않고** 각자 표면 배선이 필요하다.
    // 어느 것이 그런지는 `utils/editor/font-surfaces.ts` 의 헤더와
    // `DOCUMENT_FONT_SURFACES` 가 유일한 출처다. 여기 개수를 베껴 적지 않는다:
    // 한때 "그 30곳이 배선 추가 없이 따라온다"고 적혀 있었고 그것은 거짓이었다
    // (§349 리뷰 · final review I4). 베낀 목록은 낡고, 지목한 목록은 안 낡는다.
    applyFontVariables(tiptap, {
      bodyFont: fontFamily,
      codeFont: codeFontFamily,
      which: "both",
    });
    tiptap.style.lineHeight = String(lineHeight);
    // Also as a variable, because CSS has to compute WITH the line height, not just
    // inherit it: the list markers and the fold arrow are absolutely positioned, so they
    // centre on the first line box by arithmetic (editor/lists.css). Reading the inline
    // `line-height` is not possible from a `calc()`, which is why those offsets used to be
    // constants that only matched the default 1.75.
    tiptap.style.setProperty("--editor-line-height", String(lineHeight));
    // §354 코드 전용 크기·줄 높이. 변수인 이유는 본문과 같다 — 인라인 스타일은
    // 이 요소 하나만 덮지만, 코드는 문서 안 여러 자리(인라인 코드 · 코드블록
    // 편집기 · 그 플레이스홀더)에서 제 크기를 선언한다. 그 선언들이 지금까지
    // 쓰던 `0.875em` 의 자리를 이 변수가 대신한다.
    //
    // 연동 중이면 값이 정확히 `본문 × 0.875` 라 예전 `em` 과 같은 픽셀이 나온다.
    const code = resolveCodeMetrics({
      codeFontSize,
      codeLineHeight,
      fontSize,
      lineHeight,
      linkFontMetrics,
    });
    tiptap.style.setProperty("--editor-code-font-size", `${code.fontSize}px`);
    tiptap.style.setProperty(
      "--editor-code-line-height",
      String(code.lineHeight),
    );
    tiptap.style.maxWidth = editorMaxWidth > 0 ? `${editorMaxWidth}px` : "";
    tiptap.style.marginLeft = editorMaxWidth > 0 ? "auto" : "";
    tiptap.style.marginRight = editorMaxWidth > 0 ? "auto" : "";
  }, [
    fontSize,
    fontFamily,
    codeFontFamily,
    codeFontSize,
    codeLineHeight,
    linkFontMetrics,
    lineHeight,
    editorMaxWidth,
    editor,
  ]);

  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          ...((editor.options.editorProps?.attributes as Record<
            string,
            string
          >) ?? {}),
          spellcheck: String(spellCheck),
        },
      },
    });
  }, [spellCheck, editor]);

  // Sync OS menu labels when locale changes (and on mount)
  //
  // ‼️ Both native-menu effects load their IPC module lazily, so the module arrives a tick
  // or more after the effect ran. Without the `active` flag the `.then` fired regardless of
  // what happened in between: it pushed a menu update after the tree unmounted, and — when
  // the deps changed faster than the import resolved — an older resolution could overwrite
  // a newer sync with stale labels. Guarding is the standard cancel-aware shape for an
  // async effect.
  //
  // It does NOT make the load itself cancellable, which is why a test that renders this
  // hook must also keep the loader out of it (`ThemeEditor.test.tsx` mocks both modules):
  // an in-flight `import()` resolving after vitest tears the environment down is an
  // unhandled error that fails the run with every test passing.
  const locale = useSettingsStore((s) => s.locale);
  useEffect(() => {
    let active = true;
    import("../ipc/menu-locale").then(({ syncMenuLocale }) => {
      if (!active) return;
      syncMenuLocale(locale as "en" | "ko").catch((e) => logger.error(e));
    });
    return () => {
      active = false;
    };
  }, [locale]);

  // Sync the native "Open Recent" submenu on recent-list / locale change (and on mount)
  const recentFolders = useSettingsStore((s) => s.recentFolders);
  const recentFiles = useSettingsStore((s) => s.recentFiles);
  useEffect(() => {
    let active = true;
    import("../ipc/recent-menu").then(({ syncRecentMenu }) => {
      if (!active) return;
      syncRecentMenu().catch((e) => logger.error(e));
    });
    return () => {
      active = false;
    };
  }, [recentFolders, recentFiles, locale]);

  // §340 ⓐ 기능이 꺼질 때, 저장된 포인터가 그 기능의 좌석을 가리키고 있으면 옮긴다.
  //
  // ‼️ **가리키고 있을 때만** 옮긴다. 조건 없이 리셋하면 무관한 작업 상태를 파괴한다.
  // ‼️ 이것만으로는 부족하다(Fix E / M-1 정정: `useUIStore`엔 persist가 없다 —
  //    "재하이드레이션"은 근거가 아니다). 실제 근거: (a) 플래그 write와 이 이펙트의
  //    flush 사이의 한 프레임, (b) 이 이펙트가 볼 수 없는 writer들 — 커스텀 프리셋
  //    (`workspace.ts`의 `customPresets`, 이쪽은 진짜로 영속된다) · skills 모드가
  //    나가면서 복원하는 저장된 포인터(`use-skills-mode.ts`) · 저널 단축키가 직접
  //    쓰는 `rightPanelMode`. 셋 다 네 기능 플래그 자체를 바꾸지 않으므로 아래
  //    `useEffect`의 deps가 재발화하지 않는다 — 패널 쪽 렌더 가드(ⓑ)가 그래서 필요하다.
  // `useFeatureFlags()` returns a fresh object every render (see its own doc comment in
  // stores/settings/features.ts) — destructuring here, rather than passing the object
  // through, is what lets the effect below depend on the four primitives directly instead
  // of needing an `exhaustive-deps` suppression for a computed member access it can't narrow.
  const { ai, journal, tasks, zettelkasten } = useFeatureFlags();
  useEffect(() => {
    const ui = useUIStore.getState();
    const enabled: Record<FeatureKey, boolean> = {
      ai,
      journal,
      tasks,
      zettelkasten,
    };
    const panelFeature = SIDEBAR_PANEL_FEATURE[ui.sidebarPanel];
    if (panelFeature && !enabled[panelFeature]) {
      ui.setSidebarPanel("files");
    }
    const modeFeature = RIGHT_PANEL_MODE_FEATURE[ui.rightPanelMode];
    if (modeFeature && !enabled[modeFeature]) {
      ui.setRightPanelMode("none");
    }
  }, [ai, journal, tasks, zettelkasten]);

  // §341 꺼진 기능의 네이티브 메뉴 항목을 회색 처리한다. 위 두 메뉴 이펙트와 같은
  // `active` 플래그 형태 — 지연 import 가 언마운트 뒤에 착지할 수 있다.
  useEffect(() => {
    let active = true;
    const flags: Record<FeatureKey, boolean> = {
      ai,
      journal,
      tasks,
      zettelkasten,
    };
    import("../ipc/menu-enabled").then(({ syncMenuEnabled }) => {
      if (!active) return;
      syncMenuEnabled(flags).catch((e) => logger.error(e));
    });
    return () => {
      active = false;
    };
  }, [ai, journal, tasks, zettelkasten]);
}
