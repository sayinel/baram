// §4.2 Settings effects hook — apply theme, font, spellcheck to DOM
import { useEffect } from "react";

import type { FeatureKey } from "../stores/settings/feature-keys";
import type { Editor } from "@tiptap/core";

import { useShallow } from "zustand/shallow";

import { useFeatureFlags } from "../stores/settings/features";
import { useSettingsStore } from "../stores/settings/store";
import {
  RIGHT_PANEL_MODE_FEATURE,
  SIDEBAR_PANEL_FEATURE,
} from "../stores/ui/panel-feature";
import { useUIStore } from "../stores/ui/ui";
import { findThemeById } from "../types/theme";
import { applyFontVariables } from "../utils/editor/font-surfaces";
import { resolveCodeMetrics } from "../utils/font/code-metrics";
import { logger } from "../utils/logger";
import {
  appliesInlineVars,
  applyThemeVars,
  clearThemeVars,
} from "../utils/theme-vars";

export function useSettingsEffects(editor: Editor | null) {
  const {
    activeThemeId,
    codeFontFamily,
    codeFontSize,
    codeLineHeight,
    customThemes,
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
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      lineHeight: s.lineHeight,
      linkFontMetrics: s.linkFontMetrics,
      spellCheck: s.spellCheck,
      editorMaxWidth: s.editorMaxWidth,
    })),
  );

  useEffect(() => {
    const root = document.documentElement;

    // Clear previous CSS variable overrides
    clearThemeVars(root);

    if (activeThemeId === "system") {
      root.removeAttribute("data-theme");
      return;
    }

    const themeDef = findThemeById(activeThemeId, customThemes);
    if (!themeDef) {
      root.removeAttribute("data-theme");
      return;
    }

    // Set base mode (light/dark) for CSS + CodeMirror.
    // ‼️ NOT Mermaid any more — it renders in one fixed palette regardless
    // (MERMAID_THEME in utils/markdown/mermaid-utils.ts), because its colours
    // are baked into the SVG and would follow the editor's theme into a PDF.
    root.dataset.theme = themeDef.base;

    // For non-default themes, apply CSS variable overrides. The default themes
    // need none: src/styles/generated/ already carries their values, including the
    // accent pairing that applyThemeVars derives for everyone else (#330).
    if (appliesInlineVars(activeThemeId)) {
      applyThemeVars(root, themeDef.colors, themeDef.base);
    }
  }, [activeThemeId, customThemes]);

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
