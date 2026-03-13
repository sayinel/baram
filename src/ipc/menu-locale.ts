import { invoke } from "@tauri-apps/api/core";

import { type Locale, t } from "../i18n";

/**
 * Mapping of Rust menu item/submenu IDs → i18n keys.
 * Predefined OS items (undo, redo, cut, copy, paste, etc.) are excluded.
 */
const MENU_I18N_MAP: Record<string, string> = {
  // Submenus
  menu_app: "menu.app",
  menu_file: "menu.file",
  menu_edit: "menu.edit",
  menu_view: "menu.view",
  menu_insert: "menu.insert",
  menu_go: "menu.go",
  menu_workspace: "menu.workspace",
  menu_window: "menu.window",
  menu_help: "menu.help",

  // App menu
  app_about: "menu.app.about",
  file_settings: "menu.app.settings",

  // File menu
  file_new: "menu.file.new",
  file_open: "menu.file.open",
  file_open_folder: "menu.file.openFolder",
  file_save: "menu.file.save",
  file_save_as: "menu.file.saveAs",
  file_close_tab: "menu.file.closeTab",
  file_close_folder: "menu.file.closeFolder",
  export_doc: "menu.file.export",

  // Edit menu (predefined)
  edit_undo: "menu.edit.undo",
  edit_redo: "menu.edit.redo",
  edit_cut: "menu.edit.cut",
  edit_copy: "menu.edit.copy",
  edit_paste: "menu.edit.paste",
  edit_select_all: "menu.edit.selectAll",
  edit_find_replace: "menu.edit.findReplace",

  // View menu
  view_source: "menu.view.sourceMode",
  view_sidebar: "menu.view.sidebar",
  view_palette: "menu.view.palette",
  go_quick_switcher: "menu.view.quickSwitcher",
  view_global_search: "menu.view.globalSearch",
  view_outline: "menu.view.outline",
  view_backlinks: "menu.view.backlinks",
  view_graph: "menu.view.graph",
  view_git: "menu.view.git",
  view_calendar: "menu.view.calendar",
  view_tags: "menu.view.tags",
  view_version_history: "menu.view.versionHistory",
  view_skills_gallery: "menu.view.skillsGallery",
  view_ai_chat: "menu.view.aiChat",
  view_fullscreen: "menu.view.fullscreen",

  // Insert menu
  insert_h1: "menu.insert.heading1",
  insert_h2: "menu.insert.heading2",
  insert_h3: "menu.insert.heading3",
  insert_paragraph: "menu.insert.paragraph",
  insert_bold: "menu.insert.bold",
  insert_italic: "menu.insert.italic",
  insert_underline: "menu.insert.underline",
  insert_strikethrough: "menu.insert.strikethrough",
  insert_inline_code: "menu.insert.inlineCode",
  insert_highlight: "menu.insert.highlight",
  insert_superscript: "menu.insert.superscript",
  insert_subscript: "menu.insert.subscript",
  insert_link: "menu.insert.link",
  insert_wikilink: "menu.insert.wikilink",
  insert_image: "menu.insert.image",
  insert_table: "menu.insert.table",
  insert_code_block: "menu.insert.codeBlock",
  insert_math_block: "menu.insert.mathBlock",
  insert_mermaid: "menu.insert.mermaid",
  insert_query_block: "menu.insert.queryBlock",
  insert_blockquote: "menu.insert.blockquote",
  insert_callout: "menu.insert.callout",
  insert_toggle: "menu.insert.toggle",
  insert_definition_list: "menu.insert.definitionList",
  insert_toc: "menu.insert.toc",
  insert_ordered_list: "menu.insert.orderedList",
  insert_unordered_list: "menu.insert.unorderedList",
  insert_task_list: "menu.insert.taskList",
  insert_hr: "menu.insert.hr",
  insert_frontmatter: "menu.insert.frontmatter",
  insert_footnote: "menu.insert.footnote",

  // Go menu
  go_palette: "menu.go.palette",
  go_back: "menu.go.back",
  go_forward: "menu.go.forward",
  go_switch_doc: "menu.go.switchDoc",

  // Workspace menu
  workspace_writing: "menu.workspace.writing",
  workspace_journal: "menu.workspace.journal",
  workspace_skills: "menu.workspace.skills",

  // Window menu (predefined)
  win_minimize: "menu.window.minimize",
  win_maximize: "menu.window.maximize",
  win_close: "menu.window.close",

  // Help menu
  help_user_guide: "menu.help.userGuide",
  help_shortcuts: "menu.help.shortcuts",
  help_faq: "menu.help.faq",
  help_report: "menu.help.report",
};

/**
 * Sync OS native menu labels with the given locale.
 */
export async function syncMenuLocale(locale: Locale): Promise<void> {
  const labels: Record<string, string> = {};
  for (const [menuId, i18nKey] of Object.entries(MENU_I18N_MAP)) {
    labels[menuId] = t(i18nKey, locale);
  }
  await invoke("update_menu_locale", { labels });
}
