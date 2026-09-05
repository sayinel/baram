// Menu builder — extracted from lib.rs
// Constructs the full application menu and collects references for dynamic locale updates.

use std::collections::HashMap;

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

/// Accelerators for Go > Back / Forward.
///
/// Named constants so the properties below can be asserted. These were `Ctrl+-` and
/// `Ctrl+Shift+-`, which had two problems:
///
/// 1. A **literal** `Ctrl` rather than `CmdOrCtrl`, so macOS got `Ctrl+-` — not the platform
///    convention, which is `Cmd+[` / `Cmd+]` (Safari, Finder, Xcode).
/// 2. `use-zoom.ts` handles `(metaKey || ctrlKey) + "-"` on a window listener, so `Ctrl+-`
///    fired **Back and Zoom Out together**, on every platform.
///
/// `BracketLeft`/`BracketRight` are muda `Code` names (its parser maps `"BRACKETLEFT" | "["`),
/// chosen over the literal `[` because they name the physical key rather than a character that
/// moves between keyboard layouts. Nothing else in the app binds either bracket.
///
/// ‼️ Do not give a menu item an accelerator whose key is `-`, `=` or `0` with only Cmd/Ctrl:
/// those three belong to editor zoom (`use-zoom.ts`), which listens in the CAPTURE phase and
/// does not stop propagation, so the two fire together rather than one winning.
///
/// ‼️ Same class, different owner: a bare `Ctrl+R` (i.e. `CmdOrCtrl+R` on Windows/Linux, where
/// `CmdOrCtrl` resolves to `Ctrl`) belongs to vim mode's redo — `state-machine.ts`'s
/// `normalOrVisualStep` and `vim-code-block-boundary.ts` both bind it. See `view_reload` below
/// for how that collision was avoided rather than reintroduced.
const GO_BACK_ACCELERATOR: &str = "CmdOrCtrl+BracketLeft";
const GO_FORWARD_ACCELERATOR: &str = "CmdOrCtrl+BracketRight";

/// Stores references to custom menu items and submenus for locale updates.
pub struct MenuState {
    pub items: HashMap<String, tauri::menu::MenuItem<tauri::Wry>>,
    pub submenus: HashMap<String, tauri::menu::Submenu<tauri::Wry>>,
    pub predefined: HashMap<String, PredefinedMenuItem<tauri::Wry>>,
}

/// Build the full application menu and return the `Menu` + `MenuState` for locale updates.
pub fn build_menu(
    app: &tauri::App,
) -> Result<(Menu<tauri::Wry>, MenuState), Box<dyn std::error::Error>> {
    // --- File menu ---
    let file_new = MenuItemBuilder::new("New File")
        .id("file_new")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let file_open = MenuItemBuilder::new("Open File...")
        .id("file_open")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let file_open_folder = MenuItemBuilder::new("Open Folder...")
        .id("file_open_folder")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    // --- Open Recent submenu (§82; populated at runtime via update_recent_menu) ---
    let file_open_recent = SubmenuBuilder::new(app, "Open Recent")
        .enabled(false)
        .build()?;
    let file_save = MenuItemBuilder::new("Save")
        .id("file_save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let file_save_as = MenuItemBuilder::new("Save As...")
        .id("file_save_as")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let file_close_tab = MenuItemBuilder::new("Close Tab")
        .id("file_close_tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    // §81 Closes every tab and every open context — the whole workspace, not one
    // folder. The item id stays `file_close_folder` so the frontend's
    // `ipc/menu-locale.ts` map and the `file.closeFolder` keybinding id (which keys
    // persisted user remaps) keep pointing at the same thing.
    let file_close_folder = MenuItemBuilder::new("Close Workspace")
        .id("file_close_folder")
        .accelerator("CmdOrCtrl+Shift+W")
        .build(app)?;
    let export_doc = MenuItemBuilder::new("Export...")
        .id("export_doc")
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&file_new)
        .item(&file_open)
        .item(&file_open_folder)
        .item(&file_open_recent)
        .separator()
        .item(&file_save)
        .item(&file_save_as)
        .item(&file_close_tab)
        .item(&file_close_folder)
        .separator()
        .item(&export_doc)
        .build()?;

    // --- Edit menu (predefined OS-native items + Find) ---
    let edit_find_replace = MenuItemBuilder::new("Find & Replace")
        .id("edit_find_replace")
        .accelerator("CmdOrCtrl+H")
        .build(app)?;

    let edit_undo = PredefinedMenuItem::undo(app, None)?;
    let edit_redo = PredefinedMenuItem::redo(app, None)?;
    let edit_cut = PredefinedMenuItem::cut(app, None)?;
    let edit_copy = PredefinedMenuItem::copy(app, None)?;
    let edit_paste = PredefinedMenuItem::paste(app, None)?;
    let edit_select_all = PredefinedMenuItem::select_all(app, None)?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&edit_undo)
        .item(&edit_redo)
        .separator()
        .item(&edit_cut)
        .item(&edit_copy)
        .item(&edit_paste)
        .item(&edit_select_all)
        .separator()
        .item(&edit_find_replace)
        .build()?;

    // --- View menu ---
    //
    // `view_reload` (§479) is platform-conditional on its accelerator, not its existence: the
    // item is always in the menu, but only macOS gets `CmdOrCtrl+R` bound to it — see the
    // `Ctrl+R` ‼️ note on `GO_BACK_ACCELERATOR` above for which key it collides with and why.
    // Per the `Ctrl+-` fix (commit history: "stop Ctrl+- firing Back and Zoom Out together"), a
    // native accelerator firing does NOT stop the same keystroke's DOM keydown from also
    // reaching JS — both fire. On Windows/Linux that would mean every vim redo also triggering
    // reload, including a silent full-app reload when there is nothing to redo and no tab is
    // dirty. macOS has no such collision (`CmdOrCtrl` → `Cmd` only there, and both vim handlers
    // gate on `ctrlKey`), so it keeps the platform convention.
    //
    // Windows/Linux is NOT left keyboard-inaccessible, though: `keybinding-registry.ts`'s
    // `view.reload` entry (`Mod+R`, customizable) is the app's OWN global keydown dispatch
    // (`use-keybinding-actions.ts`), independent of this native menu. Every handler that
    // actually claims `Ctrl+R` for vim redo — the WYSIWYG state machine, the code-block
    // boundary handler, and `@replit/codemirror-vim` — calls both `preventDefault` and
    // `stopPropagation`, which stops the keystroke from ever reaching that dispatcher (verified:
    // `use-global-keyboard-reload-vim-defer.test.ts`). So on Windows/Linux, `Ctrl+R` reloads
    // whenever vim isn't actively consuming it, and defers cleanly when it is — no double-fire,
    // no dead key. Nothing here needed to change to get that; it falls out of the two systems
    // already being independent.
    #[cfg(target_os = "macos")]
    let view_reload = MenuItemBuilder::new("Reload")
        .id("view_reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    #[cfg(not(target_os = "macos"))]
    let view_reload = MenuItemBuilder::new("Reload")
        .id("view_reload")
        .build(app)?;
    let view_source = MenuItemBuilder::new("Toggle Source Mode")
        .id("view_source")
        .accelerator("CmdOrCtrl+/")
        .build(app)?;
    let view_sidebar = MenuItemBuilder::new("Toggle Sidebar")
        .id("view_sidebar")
        .accelerator("CmdOrCtrl+Shift+L")
        .build(app)?;
    let view_palette = MenuItemBuilder::new("Command Palette")
        .id("view_palette")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let view_quick_switcher = MenuItemBuilder::new("Quick Switcher")
        .id("go_quick_switcher")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;

    // Sidebar panels
    let view_global_search = MenuItemBuilder::new("Global Search")
        .id("view_global_search")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;
    let view_outline = MenuItemBuilder::new("Outline")
        .id("view_outline")
        .build(app)?;
    let view_backlinks = MenuItemBuilder::new("Backlinks")
        .id("view_backlinks")
        .accelerator("CmdOrCtrl+Shift+B")
        .build(app)?;
    let view_graph = MenuItemBuilder::new("Graph View")
        .id("view_graph")
        .build(app)?;
    let view_git = MenuItemBuilder::new("Source Control")
        .id("view_git")
        .build(app)?;
    let view_calendar = MenuItemBuilder::new("Calendar")
        .id("view_calendar")
        .build(app)?;
    let view_tags = MenuItemBuilder::new("Tags").id("view_tags").build(app)?;
    let view_version_history = MenuItemBuilder::new("Version History")
        .id("view_version_history")
        .build(app)?;
    let view_skills_gallery = MenuItemBuilder::new("Skills Gallery")
        .id("view_skills_gallery")
        .build(app)?;

    // Right panels
    let view_inline_ai = MenuItemBuilder::new("Inline AI")
        .id("view_inline_ai")
        .accelerator("CmdOrCtrl+J")
        .build(app)?;
    let view_ai_chat = MenuItemBuilder::new("AI Chat")
        .id("view_ai_chat")
        .accelerator("CmdOrCtrl+Shift+A")
        .build(app)?;

    let view_fullscreen = PredefinedMenuItem::fullscreen(app, None)?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&view_reload)
        .separator()
        .item(&view_source)
        .item(&view_sidebar)
        .separator()
        .item(&view_palette)
        .item(&view_quick_switcher)
        .separator()
        .item(&view_global_search)
        .item(&view_outline)
        .item(&view_backlinks)
        .item(&view_graph)
        .item(&view_git)
        .item(&view_calendar)
        .item(&view_tags)
        .item(&view_version_history)
        .item(&view_skills_gallery)
        .separator()
        .item(&view_inline_ai)
        .item(&view_ai_chat)
        .separator()
        .item(&view_fullscreen)
        .build()?;

    // --- Insert menu (§4.4) ---
    let insert_h1 = MenuItemBuilder::new("Heading 1")
        .id("insert_h1")
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let insert_h2 = MenuItemBuilder::new("Heading 2")
        .id("insert_h2")
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let insert_h3 = MenuItemBuilder::new("Heading 3")
        .id("insert_h3")
        .accelerator("CmdOrCtrl+3")
        .build(app)?;
    // No accelerator, deliberately. This was `CmdOrCtrl+0`, which editor zoom owns as Reset
    // Zoom — and unlike Back/Forward this handler MUTATES THE DOCUMENT
    // (`setNode("paragraph")`), so resetting zoom with the caret in a heading silently turned it
    // into body text and autosave persisted that.
    //
    // Removed rather than reassigned: it was never documented, so no user knew it existed, and
    // the action is already reachable two other ways — the block handle's Turn into → Paragraph
    // (`utils/toolbar/block-turn-into.ts`) and `Cmd+1`..`Cmd+6`, which toggle, so pressing the
    // current level again returns the block to a paragraph. Nothing is lost.
    let insert_paragraph = MenuItemBuilder::new("Paragraph")
        .id("insert_paragraph")
        .build(app)?;
    let insert_bold = MenuItemBuilder::new("Bold")
        .id("insert_bold")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;
    let insert_italic = MenuItemBuilder::new("Italic")
        .id("insert_italic")
        .accelerator("CmdOrCtrl+I")
        .build(app)?;
    let insert_underline = MenuItemBuilder::new("Underline")
        .id("insert_underline")
        .accelerator("CmdOrCtrl+U")
        .build(app)?;
    let insert_strikethrough = MenuItemBuilder::new("Strikethrough")
        .id("insert_strikethrough")
        .accelerator("CmdOrCtrl+Shift+X")
        .build(app)?;
    let insert_inline_code = MenuItemBuilder::new("Inline Code")
        .id("insert_inline_code")
        .accelerator("CmdOrCtrl+E")
        .build(app)?;
    let insert_link = MenuItemBuilder::new("Link").id("insert_link").build(app)?;
    let insert_image = MenuItemBuilder::new("Image")
        .id("insert_image")
        .build(app)?;
    let insert_table = MenuItemBuilder::new("Table")
        .id("insert_table")
        .build(app)?;
    let insert_code_block = MenuItemBuilder::new("Code Block")
        .id("insert_code_block")
        .accelerator("CmdOrCtrl+Alt+C")
        .build(app)?;
    let insert_math_block = MenuItemBuilder::new("Math Block")
        .id("insert_math_block")
        .accelerator("CmdOrCtrl+Shift+M")
        .build(app)?;
    let insert_blockquote = MenuItemBuilder::new("Blockquote")
        .id("insert_blockquote")
        .build(app)?;
    let insert_ordered_list = MenuItemBuilder::new("Ordered List")
        .id("insert_ordered_list")
        .accelerator("CmdOrCtrl+Shift+7")
        .build(app)?;
    let insert_unordered_list = MenuItemBuilder::new("Unordered List")
        .id("insert_unordered_list")
        .accelerator("CmdOrCtrl+Shift+8")
        .build(app)?;
    let insert_task_list = MenuItemBuilder::new("Task List")
        .id("insert_task_list")
        .accelerator("CmdOrCtrl+Shift+9")
        .build(app)?;
    let insert_hr = MenuItemBuilder::new("Horizontal Rule")
        .id("insert_hr")
        .build(app)?;
    let insert_frontmatter = MenuItemBuilder::new("YAML Front Matter")
        .id("insert_frontmatter")
        .build(app)?;

    // Additional block elements
    let insert_callout = MenuItemBuilder::new("Callout")
        .id("insert_callout")
        .build(app)?;
    let insert_toggle = MenuItemBuilder::new("Toggle")
        .id("insert_toggle")
        .build(app)?;
    let insert_toc = MenuItemBuilder::new("Table of Contents")
        .id("insert_toc")
        .build(app)?;
    let insert_definition_list = MenuItemBuilder::new("Definition List")
        .id("insert_definition_list")
        .build(app)?;
    let insert_mermaid = MenuItemBuilder::new("Mermaid Diagram")
        .id("insert_mermaid")
        .accelerator("CmdOrCtrl+Shift+D")
        .build(app)?;
    let insert_query_block = MenuItemBuilder::new("Query Block")
        .id("insert_query_block")
        .build(app)?;

    // Additional inline marks
    let insert_highlight = MenuItemBuilder::new("Highlight")
        .id("insert_highlight")
        .accelerator("CmdOrCtrl+Shift+H")
        .build(app)?;
    let insert_superscript = MenuItemBuilder::new("Superscript")
        .id("insert_superscript")
        .build(app)?;
    let insert_subscript = MenuItemBuilder::new("Subscript")
        .id("insert_subscript")
        .build(app)?;

    // Inline elements
    let insert_wikilink = MenuItemBuilder::new("Wiki Link")
        .id("insert_wikilink")
        .build(app)?;
    let insert_footnote = MenuItemBuilder::new("Footnote")
        .id("insert_footnote")
        .build(app)?;

    let insert_menu = SubmenuBuilder::new(app, "Insert")
        .item(&insert_h1)
        .item(&insert_h2)
        .item(&insert_h3)
        .item(&insert_paragraph)
        .separator()
        .item(&insert_bold)
        .item(&insert_italic)
        .item(&insert_underline)
        .item(&insert_strikethrough)
        .item(&insert_inline_code)
        .item(&insert_highlight)
        .item(&insert_superscript)
        .item(&insert_subscript)
        .separator()
        .item(&insert_link)
        .item(&insert_wikilink)
        .item(&insert_image)
        .separator()
        .item(&insert_table)
        .item(&insert_code_block)
        .item(&insert_math_block)
        .item(&insert_mermaid)
        .item(&insert_query_block)
        .separator()
        .item(&insert_blockquote)
        .item(&insert_callout)
        .item(&insert_toggle)
        .item(&insert_definition_list)
        .item(&insert_toc)
        .separator()
        .item(&insert_ordered_list)
        .item(&insert_unordered_list)
        .item(&insert_task_list)
        .separator()
        .item(&insert_hr)
        .item(&insert_frontmatter)
        .item(&insert_footnote)
        .build()?;

    // --- Go menu (§4.4) ---
    let go_palette = MenuItemBuilder::new("Command Palette")
        .id("go_palette")
        .accelerator("CmdOrCtrl+Shift+P")
        .build(app)?;
    let go_back = MenuItemBuilder::new("Back")
        .id("go_back")
        .accelerator(GO_BACK_ACCELERATOR)
        .build(app)?;
    let go_forward = MenuItemBuilder::new("Forward")
        .id("go_forward")
        .accelerator(GO_FORWARD_ACCELERATOR)
        .build(app)?;
    let go_switch_doc = MenuItemBuilder::new("Switch Document")
        .id("go_switch_doc")
        .accelerator("Ctrl+Tab")
        .build(app)?;

    let go_menu = SubmenuBuilder::new(app, "Go")
        .item(&go_palette)
        .separator()
        .item(&go_back)
        .item(&go_forward)
        .separator()
        .item(&go_switch_doc)
        .build()?;

    // --- Workspace menu (§52) ---
    let workspace_writing = MenuItemBuilder::new("Writing")
        .id("workspace_writing")
        .accelerator("Alt+CmdOrCtrl+1")
        .build(app)?;
    let workspace_journal = MenuItemBuilder::new("Journal")
        .id("workspace_journal")
        .accelerator("Alt+CmdOrCtrl+2")
        .build(app)?;
    let workspace_zettel = MenuItemBuilder::new("Zettel")
        .id("workspace_zettel")
        .accelerator("Alt+CmdOrCtrl+3")
        .build(app)?;
    let workspace_skills = MenuItemBuilder::new("Skills Editing")
        .id("workspace_skills")
        .accelerator("Alt+CmdOrCtrl+4")
        .build(app)?;

    let workspace_menu = SubmenuBuilder::new(app, "Workspace")
        .item(&workspace_writing)
        .item(&workspace_journal)
        .item(&workspace_zettel)
        .item(&workspace_skills)
        .build()?;

    // --- Window menu (macOS standard) ---
    let win_minimize = PredefinedMenuItem::minimize(app, None)?;
    let win_maximize = PredefinedMenuItem::maximize(app, None)?;
    let win_close = PredefinedMenuItem::close_window(app, None)?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&win_minimize)
        .item(&win_maximize)
        .separator()
        .item(&win_close)
        .build()?;

    // --- Help menu ---
    let help_user_guide = MenuItemBuilder::new("User Guide")
        .id("help_user_guide")
        .build(app)?;
    let help_shortcuts = MenuItemBuilder::new("Keyboard Shortcuts")
        .id("help_shortcuts")
        .build(app)?;
    let help_faq = MenuItemBuilder::new("FAQ").id("help_faq").build(app)?;
    let help_report = MenuItemBuilder::new("Report Issue...")
        .id("help_report")
        .build(app)?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&help_user_guide)
        .item(&help_shortcuts)
        .item(&help_faq)
        .separator()
        .item(&help_report)
        .build()?;

    // --- App menu (macOS: first submenu = application menu with Quit) ---
    let file_settings = MenuItemBuilder::new("Settings...")
        .id("file_settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let app_about = MenuItemBuilder::new("About Baram")
        .id("app_about")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "Baram")
        .item(&app_about)
        .separator()
        .item(&file_settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&insert_menu)
        .item(&go_menu)
        .item(&workspace_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;

    // Store menu items/submenus for dynamic locale updates
    let mut menu_items: HashMap<String, tauri::menu::MenuItem<tauri::Wry>> = HashMap::new();
    menu_items.insert("file_new".into(), file_new);
    menu_items.insert("file_open".into(), file_open);
    menu_items.insert("file_open_folder".into(), file_open_folder);
    menu_items.insert("file_save".into(), file_save);
    menu_items.insert("file_save_as".into(), file_save_as);
    menu_items.insert("file_close_tab".into(), file_close_tab);
    menu_items.insert("file_close_folder".into(), file_close_folder);
    menu_items.insert("export_doc".into(), export_doc);
    menu_items.insert("edit_find_replace".into(), edit_find_replace);
    menu_items.insert("view_reload".into(), view_reload);
    menu_items.insert("view_source".into(), view_source);
    menu_items.insert("view_sidebar".into(), view_sidebar);
    menu_items.insert("view_palette".into(), view_palette);
    menu_items.insert("go_quick_switcher".into(), view_quick_switcher);
    menu_items.insert("view_global_search".into(), view_global_search);
    menu_items.insert("view_outline".into(), view_outline);
    menu_items.insert("view_backlinks".into(), view_backlinks);
    menu_items.insert("view_graph".into(), view_graph);
    menu_items.insert("view_git".into(), view_git);
    menu_items.insert("view_calendar".into(), view_calendar);
    menu_items.insert("view_tags".into(), view_tags);
    menu_items.insert("view_version_history".into(), view_version_history);
    menu_items.insert("view_skills_gallery".into(), view_skills_gallery);
    menu_items.insert("view_ai_chat".into(), view_ai_chat);
    menu_items.insert("insert_h1".into(), insert_h1);
    menu_items.insert("insert_h2".into(), insert_h2);
    menu_items.insert("insert_h3".into(), insert_h3);
    menu_items.insert("insert_paragraph".into(), insert_paragraph);
    menu_items.insert("insert_bold".into(), insert_bold);
    menu_items.insert("insert_italic".into(), insert_italic);
    menu_items.insert("insert_underline".into(), insert_underline);
    menu_items.insert("insert_strikethrough".into(), insert_strikethrough);
    menu_items.insert("insert_inline_code".into(), insert_inline_code);
    menu_items.insert("insert_highlight".into(), insert_highlight);
    menu_items.insert("insert_superscript".into(), insert_superscript);
    menu_items.insert("insert_subscript".into(), insert_subscript);
    menu_items.insert("insert_link".into(), insert_link);
    menu_items.insert("insert_wikilink".into(), insert_wikilink);
    menu_items.insert("insert_image".into(), insert_image);
    menu_items.insert("insert_table".into(), insert_table);
    menu_items.insert("insert_code_block".into(), insert_code_block);
    menu_items.insert("insert_math_block".into(), insert_math_block);
    menu_items.insert("insert_mermaid".into(), insert_mermaid);
    menu_items.insert("insert_query_block".into(), insert_query_block);
    menu_items.insert("insert_blockquote".into(), insert_blockquote);
    menu_items.insert("insert_callout".into(), insert_callout);
    menu_items.insert("insert_toggle".into(), insert_toggle);
    menu_items.insert("insert_definition_list".into(), insert_definition_list);
    menu_items.insert("insert_toc".into(), insert_toc);
    menu_items.insert("insert_ordered_list".into(), insert_ordered_list);
    menu_items.insert("insert_unordered_list".into(), insert_unordered_list);
    menu_items.insert("insert_task_list".into(), insert_task_list);
    menu_items.insert("insert_hr".into(), insert_hr);
    menu_items.insert("insert_frontmatter".into(), insert_frontmatter);
    menu_items.insert("insert_footnote".into(), insert_footnote);
    menu_items.insert("go_palette".into(), go_palette);
    menu_items.insert("go_back".into(), go_back);
    menu_items.insert("go_forward".into(), go_forward);
    menu_items.insert("go_switch_doc".into(), go_switch_doc);
    menu_items.insert("workspace_writing".into(), workspace_writing);
    menu_items.insert("workspace_journal".into(), workspace_journal);
    menu_items.insert("workspace_skills".into(), workspace_skills);
    menu_items.insert("workspace_zettel".into(), workspace_zettel);
    menu_items.insert("help_user_guide".into(), help_user_guide);
    menu_items.insert("help_shortcuts".into(), help_shortcuts);
    menu_items.insert("help_faq".into(), help_faq);
    menu_items.insert("help_report".into(), help_report);
    menu_items.insert("app_about".into(), app_about);
    menu_items.insert("file_settings".into(), file_settings);

    let mut menu_subs: HashMap<String, tauri::menu::Submenu<tauri::Wry>> = HashMap::new();
    menu_subs.insert("menu_file".into(), file_menu);
    menu_subs.insert("menu_file_open_recent".into(), file_open_recent);
    menu_subs.insert("menu_edit".into(), edit_menu);
    menu_subs.insert("menu_view".into(), view_menu);
    menu_subs.insert("menu_insert".into(), insert_menu);
    menu_subs.insert("menu_go".into(), go_menu);
    menu_subs.insert("menu_workspace".into(), workspace_menu);
    menu_subs.insert("menu_window".into(), window_menu);
    menu_subs.insert("menu_help".into(), help_menu);
    menu_subs.insert("menu_app".into(), app_menu);

    let mut menu_predef: HashMap<String, PredefinedMenuItem<tauri::Wry>> = HashMap::new();
    menu_predef.insert("edit_undo".into(), edit_undo);
    menu_predef.insert("edit_redo".into(), edit_redo);
    menu_predef.insert("edit_cut".into(), edit_cut);
    menu_predef.insert("edit_copy".into(), edit_copy);
    menu_predef.insert("edit_paste".into(), edit_paste);
    menu_predef.insert("edit_select_all".into(), edit_select_all);
    menu_predef.insert("view_fullscreen".into(), view_fullscreen);
    menu_predef.insert("win_minimize".into(), win_minimize);
    menu_predef.insert("win_maximize".into(), win_maximize);
    menu_predef.insert("win_close".into(), win_close);

    let state = MenuState {
        items: menu_items,
        submenus: menu_subs,
        predefined: menu_predef,
    };

    Ok((menu, state))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The three keys editor zoom owns (`use-zoom.ts`), as bare Cmd/Ctrl combinations.
    ///
    /// That handler listens on `window` in the CAPTURE phase and calls only `preventDefault()`
    /// — it never stops propagation — so a menu accelerator on the same key does not lose the
    /// race, it fires TOO. `Ctrl+-` did exactly that: Back and Zoom Out on one keystroke.
    const ZOOM_OWNED_KEYS: [&str; 3] = ["-", "=", "0"];

    fn key_of(accelerator: &str) -> &str {
        accelerator.rsplit('+').next().unwrap_or(accelerator)
    }

    #[test]
    fn go_accelerators_use_the_platform_modifier() {
        // `CmdOrCtrl`, never a literal `Ctrl`: on macOS a literal `Ctrl` is not the convention
        // for navigation, and it was how these two ended up on a zoom key in the first place.
        //
        // NOT asserted for every accelerator in this file: `Ctrl+Tab` (Switch Document) is
        // deliberately literal, because `Cmd+Tab` is the macOS application switcher and cannot
        // be claimed by an app. A blanket rule here would be wrong.
        for accelerator in [GO_BACK_ACCELERATOR, GO_FORWARD_ACCELERATOR] {
            assert!(
                accelerator.starts_with("CmdOrCtrl+"),
                "{accelerator} must use CmdOrCtrl so macOS gets Cmd"
            );
        }
    }

    /// This file's own source, so the check below covers EVERY menu item rather than the two
    /// constants. Only possible now that Paragraph's `CmdOrCtrl+0` is gone; while it was there,
    /// a whole-file rule could not have been written without failing.
    const MENU_SOURCE: &str = include_str!("menu.rs");

    /// Every accelerator written as a literal, plus the two that use constants.
    fn all_accelerators() -> Vec<&'static str> {
        let mut found: Vec<&str> = MENU_SOURCE
            .split(".accelerator(\"")
            .skip(1) // text before the first match
            .filter_map(|rest| rest.split('"').next())
            .collect();
        // `.accelerator(GO_BACK_ACCELERATOR)` has no quote, so the split above cannot see it.
        found.push(GO_BACK_ACCELERATOR);
        found.push(GO_FORWARD_ACCELERATOR);
        found
    }

    #[test]
    fn accelerator_extraction_actually_finds_them() {
        // ‼️ Without this, a broken extractor makes the rule below pass over an EMPTY list —
        // the failure mode where a guard reports success having checked nothing. The bound is
        // loose so adding or removing a menu item does not fail here, but a regex-level break
        // (which yields 0 or 1) does.
        let found = all_accelerators();
        assert!(
            found.len() >= 35,
            "expected the menu to define at least 35 accelerators, extracted {}: {found:?}",
            found.len()
        );
        assert!(
            found.contains(&GO_BACK_ACCELERATOR),
            "the constant-based accelerators must be included"
        );
    }

    #[test]
    fn no_accelerator_lands_on_a_key_editor_zoom_owns() {
        // Applies to EVERY accelerator, and ignores the other modifiers on purpose:
        // `use-zoom.ts` guards only `if (!e.metaKey && !e.ctrlKey) return;` and then switches on
        // `e.key`, so it does NOT require Shift and Alt to be absent. `Alt+CmdOrCtrl+0` would
        // collide just as `CmdOrCtrl+0` did — which is why moving Paragraph to `Alt+Cmd+0` was
        // rejected rather than chosen.
        for accelerator in all_accelerators() {
            let key = key_of(accelerator);
            assert!(
                !ZOOM_OWNED_KEYS.contains(&key),
                "{accelerator} lands on '{key}', which editor zoom also handles — \
                 both fire on one keystroke, because the zoom listener is in the capture \
                 phase and does not stop propagation"
            );
        }
    }

    #[test]
    fn key_of_reads_the_key_not_a_modifier() {
        // Guards the helper the two assertions above depend on: if it returned a modifier the
        // zoom check would pass vacuously for every accelerator.
        assert_eq!(key_of("CmdOrCtrl+BracketLeft"), "BracketLeft");
        assert_eq!(key_of("Ctrl+Shift+-"), "-");
        assert_eq!(key_of("CmdOrCtrl+0"), "0");
    }
}
