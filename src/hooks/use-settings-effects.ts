// §4.2 Settings effects hook — apply theme, font, spellcheck to DOM
import { useEffect } from "react";

import type { Editor } from "@tiptap/core";

import { useShallow } from "zustand/shallow";

import { useSettingsStore } from "../stores/settings/store";
import { findThemeById } from "../types/theme";
import { logger } from "../utils/logger";
import { applyThemeVars, clearThemeVars } from "../utils/theme-vars";

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

    // Set base mode (light/dark) for CSS + CodeMirror/Mermaid
    root.dataset.theme = themeDef.base;

    // For non-default themes, apply CSS variable overrides. The default themes
    // need none: src/styles/generated/ already carries their values, including the
    // accent pairing that applyThemeVars derives for everyone else (#330).
    const isDefault =
      activeThemeId === "default-light" || activeThemeId === "default-dark";
    if (!isDefault) {
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
  const locale = useSettingsStore((s) => s.locale);
  useEffect(() => {
    import("../ipc/menu-locale").then(({ syncMenuLocale }) => {
      syncMenuLocale(locale as "en" | "ko").catch((e) => logger.error(e));
    });
  }, [locale]);

  // Sync the native "Open Recent" submenu on recent-list / locale change (and on mount)
  const recentFolders = useSettingsStore((s) => s.recentFolders);
  const recentFiles = useSettingsStore((s) => s.recentFiles);
  useEffect(() => {
    import("../ipc/recent-menu").then(({ syncRecentMenu }) => {
      syncRecentMenu().catch((e) => logger.error(e));
    });
  }, [recentFolders, recentFiles, locale]);
}
