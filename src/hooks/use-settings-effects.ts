// §4.2 Settings effects hook — apply theme, font, spellcheck to DOM
import { useEffect } from "react";

import type { Editor } from "@tiptap/core";

import { useShallow } from "zustand/shallow";

import { useSettingsStore } from "../stores/settings/store";
import { findThemeById } from "../types/theme";
import { logger } from "../utils/logger";
import {
  appliesInlineVars,
  applyThemeVars,
  clearThemeVars,
} from "../utils/theme-vars";

export function useSettingsEffects(editor: Editor | null) {
  const {
    activeThemeId,
    customThemes,
    fontSize,
    fontFamily,
    lineHeight,
    spellCheck,
    editorMaxWidth,
  } = useSettingsStore(
    useShallow((s) => ({
      activeThemeId: s.activeThemeId,
      customThemes: s.customThemes,
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      lineHeight: s.lineHeight,
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
    tiptap.style.fontFamily = fontFamily
      ? `${fontFamily}, var(--font-family-editor)`
      : "";
    tiptap.style.lineHeight = String(lineHeight);
    // Also as a variable, because CSS has to compute WITH the line height, not just
    // inherit it: the list markers and the fold arrow are absolutely positioned, so they
    // centre on the first line box by arithmetic (editor/lists.css). Reading the inline
    // `line-height` is not possible from a `calc()`, which is why those offsets used to be
    // constants that only matched the default 1.75.
    tiptap.style.setProperty("--editor-line-height", String(lineHeight));
    tiptap.style.maxWidth = editorMaxWidth > 0 ? `${editorMaxWidth}px` : "";
    tiptap.style.marginLeft = editorMaxWidth > 0 ? "auto" : "";
    tiptap.style.marginRight = editorMaxWidth > 0 ? "auto" : "";
  }, [fontSize, fontFamily, lineHeight, editorMaxWidth, editor]);

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
}
