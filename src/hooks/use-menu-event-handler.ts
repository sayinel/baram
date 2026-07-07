// Native menu event handler hook — dispatches Tauri menu-event payloads to app actions
import { useEffect } from "react";

import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { Editor } from "@tiptap/react";

import { getAction } from "../keybindings/keybinding-actions";
import { useWorkspaceStore } from "../stores/file/workspace";
import { useUIStore } from "../stores/ui/ui";
import { showPrompt } from "../utils/ai-commands";

interface MenuEventHandlerDeps {
  editor: Editor | null;
  handleCloseFolder: () => void;
  handleCloseTab: () => void;
  handleGoBack: () => void;
  handleGoForward: () => void;
  handleNewFile: (name?: string) => void;
  handleOpenFile: () => Promise<void>;
  handleOpenFilePath: (filePath: string) => Promise<void>;
  handleOpenFolder: () => Promise<void>;
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  setFindReplaceOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleCommandPalette: () => void;
  toggleQuickSwitcher: () => void;
  toggleSettings: () => void;
  toggleSidebar: () => void;
  toggleSourceMode: () => void;
}

/**
 * Hook that listens for native Tauri menu-event and dispatches
 * to the appropriate handler based on the event payload string.
 */
export function useMenuEventHandler({
  editor,
  handleCloseFolder,
  handleCloseTab,
  handleGoBack,
  handleGoForward,
  handleNewFile,
  handleOpenFile,
  handleOpenFilePath,
  handleOpenFolder,
  handleSave,
  handleSaveAs,
  setFindReplaceOpen,
  toggleCommandPalette,
  toggleQuickSwitcher,
  toggleSettings,
  toggleSidebar,
  toggleSourceMode,
}: MenuEventHandlerDeps): void {
  useEffect(() => {
    const unlisten = listen<string>("menu-event", async (event) => {
      switch (event.payload) {
        case "app_about":
          useUIStore.getState().toggleAbout();
          break;
        // --- Edit menu handlers ---
        case "edit_find_replace":
          setFindReplaceOpen((prev) => !prev);
          break;
        case "export_doc":
          useUIStore.getState().openExportDialog("pdf");
          break;
        case "file_close_folder":
          handleCloseFolder();
          break;
        case "file_close_tab":
          handleCloseTab();
          break;
        case "file_new":
          handleNewFile();
          break;
        case "file_open":
          handleOpenFile();
          break;
        case "file_open_folder":
          handleOpenFolder();
          break;
        case "file_save":
          handleSave();
          break;
        case "file_save_as":
          handleSaveAs();
          break;
        case "file_settings":
          toggleSettings();
          break;
        case "go_back":
          handleGoBack();
          break;
        case "go_forward":
          handleGoForward();
          break;
        case "go_palette":
        case "view_palette":
          toggleCommandPalette();
          break;
        case "go_quick_switcher":
        case "go_switch_doc":
          toggleQuickSwitcher();
          break;
        case "help_faq":
          useUIStore.getState().setRightPanelMode("help");
          if (!useUIStore.getState().rightPanelOpen) {
            useUIStore.getState().toggleRightPanel();
          }
          window.dispatchEvent(new CustomEvent("help-tab", { detail: "faq" }));
          break;

        case "help_report":
          openUrl("https://github.com/sayinel/baram/issues").catch(() => {});
          break;
        case "help_shortcuts":
          useUIStore.getState().setRightPanelMode("help");
          if (!useUIStore.getState().rightPanelOpen) {
            useUIStore.getState().toggleRightPanel();
          }
          window.dispatchEvent(
            new CustomEvent("help-tab", { detail: "shortcuts" }),
          );
          break;
        // --- Help menu handlers ---
        case "help_user_guide":
          useUIStore.getState().setRightPanelMode("help");
          if (!useUIStore.getState().rightPanelOpen) {
            useUIStore.getState().toggleRightPanel();
          }
          window.dispatchEvent(
            new CustomEvent("help-tab", { detail: "guide" }),
          );
          break;
        case "insert_blockquote":
          editor?.chain().focus().toggleBlockquote().run();
          break;
        case "insert_bold":
          editor?.chain().focus().toggleBold().run();
          break;
        // --- Insert menu: new block handlers ---
        case "insert_callout":
          editor?.commands.setCallout({ type: "info" });
          break;
        case "insert_code_block":
          editor?.chain().focus().toggleCodeBlock().run();
          break;
        case "insert_definition_list":
          editor?.commands.setDefinitionList();
          break;
        case "insert_footnote": {
          if (!editor) break;
          const fnId = `fn-${Date.now()}`;
          editor.commands.insertFootnoteRef(fnId);
          break;
        }
        case "insert_frontmatter":
          editor
            ?.chain()
            .focus()
            .insertContent({ type: "frontmatter", attrs: { yaml: "" } })
            .run();
          break;
        // --- Insert menu handlers ---
        case "insert_h1":
          editor?.chain().focus().toggleHeading({ level: 1 }).run();
          break;
        case "insert_h2":
          editor?.chain().focus().toggleHeading({ level: 2 }).run();
          break;
        case "insert_h3":
          editor?.chain().focus().toggleHeading({ level: 3 }).run();
          break;
        // --- Insert menu: new inline mark handlers ---
        case "insert_highlight":
          editor?.chain().focus().toggleHighlight().run();
          break;
        case "insert_hr":
          editor?.chain().focus().setHorizontalRule().run();
          break;
        case "insert_image": {
          if (!editor) break;
          const imagePath = await open({
            filters: [
              {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"],
              },
            ],
          });
          if (imagePath) {
            editor.chain().focus().setImage({ src: imagePath }).run();
          }
          break;
        }
        case "insert_inline_code":
          editor?.chain().focus().toggleCode().run();
          break;
        case "insert_italic":
          editor?.chain().focus().toggleItalic().run();
          break;
        case "insert_link": {
          if (!editor) break;
          const { from, to } = editor.state.selection;
          if (from === to) break; // Need selection for link
          showPrompt("Enter URL:").then((url) => {
            if (url) {
              editor.chain().focus().toggleLink({ href: url }).run();
            }
          });
          break;
        }
        case "insert_math_block":
          editor?.chain().focus().setMathBlock().run();
          break;

        case "insert_mermaid":
          editor?.commands.setMermaidBlock();
          break;
        case "insert_ordered_list":
          editor?.chain().focus().toggleOrderedList().run();
          break;
        case "insert_paragraph":
          editor?.chain().focus().setNode("paragraph").run();
          break;
        case "insert_query_block":
          editor?.commands.setQueryBlock();
          break;

        case "insert_strikethrough":
          editor?.chain().focus().toggleStrike().run();
          break;

        case "insert_subscript":
          editor?.chain().focus().toggleSubscript().run();
          break;
        case "insert_superscript":
          editor?.chain().focus().toggleSuperscript().run();
          break;
        case "insert_table":
          editor
            ?.chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run();
          break;
        case "insert_task_list":
          editor?.chain().focus().toggleTaskList().run();
          break;
        case "insert_toc":
          editor?.commands.insertTableOfContents();
          break;
        case "insert_toggle":
          editor?.commands.setToggle();
          break;
        case "insert_underline":
          editor?.chain().focus().toggleUnderline().run();
          break;
        case "insert_unordered_list":
          editor?.chain().focus().toggleBulletList().run();
          break;
        // --- Insert menu: inline element handlers ---
        case "insert_wikilink":
          editor?.chain().focus().insertContent("[[]]").run();
          break;

        // --- View menu: right panel handlers ---
        case "view_ai_chat": {
          const uiAI = useUIStore.getState();
          if (!uiAI.rightPanelOpen) {
            uiAI.setRightPanelMode("chat");
            uiAI.toggleRightPanel();
          } else if (uiAI.rightPanelMode === "chat") {
            uiAI.toggleRightPanel();
          } else {
            uiAI.setRightPanelMode("chat");
          }
          break;
        }

        case "view_backlinks": {
          const uiBL = useUIStore.getState();
          if (!uiBL.sidebarOpen) uiBL.toggleSidebar();
          uiBL.setSidebarPanel("backlinks");
          break;
        }
        case "view_calendar": {
          const uiCAL = useUIStore.getState();
          if (!uiCAL.sidebarOpen) uiCAL.toggleSidebar();
          uiCAL.setSidebarPanel("calendar");
          break;
        }
        case "view_git": {
          const uiGIT = useUIStore.getState();
          if (!uiGIT.sidebarOpen) uiGIT.toggleSidebar();
          uiGIT.setSidebarPanel("git");
          break;
        }
        // --- View menu: sidebar panel handlers ---
        case "view_global_search": {
          const uiGS = useUIStore.getState();
          if (!uiGS.sidebarOpen) uiGS.toggleSidebar();
          uiGS.setSidebarPanel("search");
          break;
        }
        case "view_graph": {
          const uiGR = useUIStore.getState();
          if (!uiGR.sidebarOpen) uiGR.toggleSidebar();
          uiGR.setSidebarPanel("graph");
          break;
        }
        case "view_inline_ai":
          getAction("insert.inlineAI")?.();
          break;
        case "view_outline": {
          const uiOL = useUIStore.getState();
          if (!uiOL.sidebarOpen) uiOL.toggleSidebar();
          uiOL.setSidebarPanel("outline");
          break;
        }

        case "view_sidebar":
          toggleSidebar();
          break;
        case "view_skills_gallery": {
          const uiSG = useUIStore.getState();
          if (!uiSG.sidebarOpen) uiSG.toggleSidebar();
          uiSG.setSidebarPanel("skills-gallery");
          break;
        }
        case "view_source":
          toggleSourceMode();
          break;

        case "view_tags": {
          const uiTAG = useUIStore.getState();
          if (!uiTAG.sidebarOpen) uiTAG.toggleSidebar();
          uiTAG.setSidebarPanel("tags");
          break;
        }
        case "view_version_history": {
          const uiVH = useUIStore.getState();
          if (!uiVH.sidebarOpen) uiVH.toggleSidebar();
          uiVH.setSidebarPanel("snapshots");
          break;
        }

        case "workspace_journal":
          useWorkspaceStore.getState().applyPreset("journal");
          break;
        case "workspace_skills":
          useWorkspaceStore.getState().applyPreset("skills");
          break;
        // --- Workspace menu handlers (§52) ---
        case "workspace_writing":
          useWorkspaceStore.getState().applyPreset("writing");
          break;
        case "workspace_zettel":
          useWorkspaceStore.getState().applyPreset("zettelkasten");
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [
    handleNewFile,
    handleOpenFile,
    handleOpenFolder,
    handleSave,
    handleSaveAs,
    handleCloseTab,
    handleCloseFolder,
    handleGoBack,
    handleGoForward,
    handleOpenFilePath,
    toggleSourceMode,
    toggleSidebar,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    editor,
    setFindReplaceOpen,
  ]);
}
