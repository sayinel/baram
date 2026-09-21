// §4.2 Settings effects hook — apply theme, font, spellcheck to DOM
import { useEffect, useRef } from "react";

import type { FeatureKey } from "../stores/settings/feature-keys";
import type { Editor } from "@tiptap/core";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../i18n/useTranslation";
import { useFeatureFlags } from "../stores/settings/features";
import { useSettingsStore } from "../stores/settings/store";
import { usePluginStore } from "../stores/system/plugin";
import { useThemeCssCacheStore } from "../stores/system/theme-css-cache";
import {
  RIGHT_PANEL_MODE_FEATURE,
  SIDEBAR_PANEL_FEATURE,
} from "../stores/ui/panel-feature";
import { useUIStore } from "../stores/ui/ui";
import { lookupThemes } from "../themes/installed-theme-defs";
import {
  themeBlocksApply,
  themeRevocationFor,
} from "../themes/theme-revocation";
import { findThemeById, resolveThemeMode } from "../types/theme";
import { applyFontVariables } from "../utils/editor/font-surfaces";
import { resolveCodeMetrics } from "../utils/font/code-metrics";
import { logger } from "../utils/logger";
import {
  appliesInlineVars,
  applyThemeCss,
  applyThemeVars,
  clearThemeVars,
  subscribeThemePreviewRelease,
  themePreviewOwned,
} from "../utils/theme-vars";
import { useAppearanceDials } from "./use-appearance-dials";
import { useThemeCssHydration } from "./use-theme-css-hydration";

export function useSettingsEffects(editor: Editor | null) {
  const { t } = useTranslation();
  useAppearanceDials();
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
    })),
  );
  // §361 Task 6 / spec 0049 §9.4 — a theme the registry has withdrawn as MALICIOUS stops
  // being applied, and the app falls back to `system`.
  //
  // ‼️ COMPUTED DURING RENDER AND USED BY THE APPLY EFFECT AND THE HYDRATION HOOK, rather
  // than fixed afterwards by an effect that writes the store. The store write happens too
  // (below — `activeThemeId` has to stop naming a theme that must not be worn), but the
  // derived id is what keeps the withdrawn theme from ever reaching `<html>`.
  //
  // Measured on this branch (2026-09-20), because the first version of this comment guessed
  // and guessed wrong. Reverting to the effect-only shape — every reader below on
  // `activeThemeId` — does NOT leave a `<style>` behind for a commit, because the store
  // revert re-runs the apply effect and its first line is `clearThemeVars`. What it does is
  // write the withdrawn theme's colours to `<html>` and take them off again inside one
  // update, which the DOM cannot be asked about afterwards. `applyThemeVars` being called at
  // all is the observable difference, and that is what
  // `use-settings-effects-theme-revoked.test.tsx` records. The stored CSS is the plainer
  // half: with the derived id the hydration hook never asks the disk for it.
  //
  // Only `malicious` — `themeBlocksApply` is `blocksLoad`, and that file carries the reading
  // of §9.4 that makes it so.
  //
  // ‼️ §9.4 SAYS "즉시", AND THAT IS NOT "BEFORE FIRST PAINT" (0090 final review, L6). This
  // reads `revocations` out of the PLUGIN store, which is `null` until that store's async
  // persist hydration lands; the settings store hydrates independently and can land first.
  // When it does, a withdrawn theme's CSS paints until the plugin store arrives or
  // `refreshRevocations` returns — milliseconds, but real. Plugins do not have this window:
  // `plugin-lifecycle.ts` waits on the bounded refresh before loading any of them.
  //
  // Left as it is, on purpose. The exposure is cosmetic rather than structural, because
  // those bytes went through the hygiene pipeline and are re-verified at injection — no
  // code, no network, no `!important` reaching a security surface. Closing it would mean
  // holding the whole theme layer behind another store's hydration, which trades a
  // guaranteed unstyled flash for every launch against milliseconds in the rare one. What
  // must not happen is someone reading §9.4's "즉시" as a pre-paint guarantee: it is
  // "as soon as the withdrawal is known", and this is where "known" is decided.
  const revocations = usePluginStore((s) => s.revocations);
  const activeRevocation = themeRevocationFor(
    activeThemeId,
    installedThemes,
    revocations,
  );
  const forceDeactivated = themeBlocksApply(activeRevocation);
  const effectiveThemeId = forceDeactivated ? "system" : activeThemeId;
  /**
   * The id whose withdrawal has already been announced, so React's double-invoked effects
   * do not stack two identical toasts for one refusal.
   *
   * ‼️ CLEARED WHENEVER NOTHING IS FORCE-DEACTIVATED, which is what makes a SECOND attempt
   * audible (fix round 1, F2). The first version of this was a Set that only grew, so
   * re-selecting the withdrawn card — which the gallery still allows, because the card is a
   * theme the user owns and can choose to remove — reverted to `system` in total silence
   * and read as a card that simply does not work. The reset is safe against a loop: the
   * revert makes `forceDeactivated` false, this effect runs once more to clear, and nothing
   * re-arms until the user chooses that theme again.
   */
  const announcedRevocation = useRef<null | string>(null);

  useEffect(() => {
    if (!forceDeactivated) {
      announcedRevocation.current = null;
      return;
    }
    const withdrawn = installedThemes[activeThemeId];
    useSettingsStore.getState().setActiveTheme("system");
    if (announcedRevocation.current === activeThemeId) return;
    announcedRevocation.current = activeThemeId;
    // The light DOM is sound HERE specifically, and the reason is ordering rather than
    // trust: the only community CSS this document can be carrying is the theme that was
    // just refused, and the apply effect — which reads `effectiveThemeId`, already
    // `"system"` — has taken its `<style>` out before this runs. A withdrawn theme that was
    // NOT active never had a `<style>` on the page to begin with, and reaches the user
    // through the gallery's `PluginRevokedNotice`, which IS shadow-isolated.
    useUIStore.getState().showToast(
      t("settings.appearance.revokedDeactivatedToast", {
        name: withdrawn?.manifest.name ?? activeThemeId,
      }),
      "warning",
    );
  }, [activeThemeId, forceDeactivated, installedThemes, t]);

  // §361 — a community theme's CSS text is not in the settings store (only a `css: boolean`
  // flag is; see `InstalledTheme`'s doc comment), so it has to be re-read off disk. This
  // hook does that re-read and drops the result in `useThemeCssCacheStore`, which the apply
  // effect below reads via `cssCacheEntries`.
  useThemeCssHydration(effectiveThemeId, installedThemes);
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
        effectiveThemeId === "system"
          ? undefined
          : findThemeById(
              effectiveThemeId,
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
        appliesInlineVars(effectiveThemeId) &&
        colors !== undefined
      ) {
        applyThemeVars(root, colors, mode);
      }

      // §358 스펙 §6 의 순서 — generated → 토큰 → CSS. 테마 CSS 가 마지막인 이유는
      // 그것이 토큰을 읽는 쪽이기 때문이다. 저장된 바이트가 계약을 지키는지는
      // applyThemeCss 가 주입 직전에 다시 본다(설치 때 통과한 사실을 믿지 않는다).
      applyThemeCss(document, assets?.css);
    };

    // ‼️ 미리보기가 주인이면 **어느 경로로도 적용하지 않는다**(외부 리뷰 #1).
    //
    // 예전에는 이 가드가 아래 `onSchemeChange` 에만 걸려 있었고 이펙트 본문은 무조건
    // `apply()` 를 불렀다. 그 시절에는 이펙트를 다시 돌릴 입력이 사용자 조작뿐이라
    // 차이가 없었지만, §361 이 deps 에 `installedThemes`·`cssCacheEntries` 를 더하면서
    // **비동기 입구**가 생겼다 — 하이드레이션 훅의 자체 `prefers-color-scheme` 리스너가
    // 캐시를 쓰면 이펙트가 다시 돌고, 그 본문이 미리보기 위에 `clearThemeVars` 와 저장된
    // 팔레트와 `data-theme` 을 덮었다. 아래 주석이 서술하는 결함 그대로이고, 그 주석의
    // "새 문으로 되살아난 것" 이 자기 자신에게 적용된 셈이다. **관문은 옳았고 모든 입력이
    // 거기 도달하지 않았다.**
    //
    // deps 가 늘어난 이유(늦게 도착하는 CSS 를 적용해야 한다)는 그대로 지킨다 — 건너뛴
    // 적용은 버리지 않고, 소유권이 풀릴 때 다시 돌린다.
    let skippedWhilePreviewing = false;
    const applyUnlessPreviewing = () => {
      if (themePreviewOwned()) {
        skippedWhilePreviewing = true;
        return;
      }
      skippedWhilePreviewing = false;
      apply();
    };

    applyUnlessPreviewing();
    // ‼️ 건너뛴 것을 되찾는 자리. 아래 주석은 "편집기를 닫으면 restorePreview()가,
    // 저장하면 이 이펙트의 재실행이" 복구한다고 적는데, 그것은 **OS 전환**에 대해서만
    // 참이다(그 전환이 움직이는 것은 인라인 변수와 `data-theme` 뿐이고 restorePreview 가
    // 정확히 그 둘을 되돌린다). 하이드레이션이 실어 오는 `<style>` 은 restorePreview 가
    // 손대지 않고(`clearThemeCss` 주석), 저장하지 않고 닫으면 이 이펙트의 deps 도 움직이지
    // 않는다 — 그래서 그 경로만은 알림이 필요하다(`subscribeThemePreviewRelease`).
    const unsubscribeRelease = subscribeThemePreviewRelease(() => {
      if (skippedWhilePreviewing) applyUnlessPreviewing();
    });
    // ‼️ 테마 편집기가 열려 있는 동안에는 OS 전환을 **듣기만 하고 적용하지 않는다**.
    // apply()의 첫 줄이 clearThemeVars이므로, 색을 드래그하는 중에 해가 져서 macOS가
    // 다크로 넘어가면 미리보기가 지워지고 저장된 테마가 다시 깔린다 — ThemeEditor의
    // preview effect는 deps가 [colors, base]라 다시 돌지 않으므로 hex 스와치가 화면에
    // 없는 색을 설명하게 되고, 더 나쁘게는 data-theme이 **저장된** 테마의 모드로
    // 되돌아간다. 그것은 ThemeEditor.tsx의 preview effect 주석("…옛 base로 남은 혼합
    // 미리보기", 현재 :100-103)이 막으려고 쓴 결함이 새 문으로 되살아난 것이다.
    // 건너뛴 전환은 잃지 않는다: 편집기를 닫으면 restorePreview()가, 저장하면 이
    // 이펙트의 재실행이 각각 그 시점의 mql.matches를 다시 읽는다.
    mql.addEventListener("change", applyUnlessPreviewing);
    return () => {
      mql.removeEventListener("change", applyUnlessPreviewing);
      unsubscribeRelease();
    };
    // §361 — `installedThemes`/`cssCacheEntries` added: a community theme's CSS arrives
    // AFTER this effect's first run (the hydration hook above fetches it asynchronously),
    // so the effect has to re-run once the cache fills in, or the theme stays colour-only
    // until something else happens to change activeThemeId/customThemes.
  }, [effectiveThemeId, customThemes, installedThemes, cssCacheEntries]);

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
  }, [
    fontSize,
    fontFamily,
    codeFontFamily,
    codeFontSize,
    codeLineHeight,
    linkFontMetrics,
    lineHeight,
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
