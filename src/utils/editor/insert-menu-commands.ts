// The native menu's Insert commands, which act on whichever editor the window they were sent to
// holds. Shared by the main window (`use-menu-event-handler.ts`) and a file window
// (`use-file-window-menu.ts`), so the two cannot come to mean different things by one menu item.
import { open } from "@tauri-apps/plugin-dialog";

import type { Editor } from "@tiptap/react";

import { chainWithVimExternalEdit } from "../../extensions/plugins/vim/vim-keys";
import { type Locale, t } from "../../i18n";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { showPrompt } from "../ai-commands";
import { registerEditorMutationTask } from "./mutation-tasks";

export function isInsertMenuCommand(id: string): boolean {
  return id.startsWith("insert_");
}

export async function runInsertMenuCommand(
  id: string,
  editor: Editor | null,
): Promise<void> {
  switch (id) {
    case "insert_blockquote":
      chainWithVimExternalEdit(editor)?.focus().toggleBlockquote().run();
      break;
    case "insert_bold":
      chainWithVimExternalEdit(editor)?.focus().toggleBold().run();
      break;
    // --- Insert menu: new block handlers ---
    case "insert_callout":
      chainWithVimExternalEdit(editor)?.setCallout({ type: "info" }).run();
      break;
    case "insert_code_block":
      chainWithVimExternalEdit(editor)?.focus().toggleCodeBlock().run();
      break;
    case "insert_definition_list":
      chainWithVimExternalEdit(editor)?.setDefinitionList().run();
      break;
    case "insert_footnote": {
      if (!editor) break;
      const fnId = `fn-${Date.now()}`;
      chainWithVimExternalEdit(editor).insertFootnoteRef(fnId).run();
      break;
    }
    case "insert_frontmatter":
      chainWithVimExternalEdit(editor)
        ?.focus()
        .insertContent({ type: "frontmatter", attrs: { yaml: "" } })
        .run();
      break;
    // --- Insert menu handlers ---
    case "insert_h1":
      chainWithVimExternalEdit(editor)
        ?.focus()
        .toggleHeading({ level: 1 })
        .run();
      break;
    case "insert_h2":
      chainWithVimExternalEdit(editor)
        ?.focus()
        .toggleHeading({ level: 2 })
        .run();
      break;
    case "insert_h3":
      chainWithVimExternalEdit(editor)
        ?.focus()
        .toggleHeading({ level: 3 })
        .run();
      break;
    // --- Insert menu: new inline mark handlers ---
    case "insert_highlight":
      chainWithVimExternalEdit(editor)?.focus().toggleHighlight().run();
      break;
    case "insert_hr":
      chainWithVimExternalEdit(editor)?.focus().setHorizontalRule().run();
      break;
    case "insert_image": {
      if (!editor) break;
      // §298 §12-9b (design §5c): native dialog = unbounded async gap.
      const task = registerEditorMutationTask(editor.view);
      const imagePath = await open({
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"],
          },
        ],
      });
      const live = task.isLive();
      task.finish();
      if (imagePath && live) {
        chainWithVimExternalEdit(editor)
          .focus()
          .setImage({ src: imagePath })
          .run();
      }
      break;
    }
    case "insert_inline_code":
      chainWithVimExternalEdit(editor)?.focus().toggleCode().run();
      break;
    case "insert_italic":
      chainWithVimExternalEdit(editor)?.focus().toggleItalic().run();
      break;
    case "insert_link": {
      if (!editor) break;
      const { from, to } = editor.state.selection;
      if (from === to) break; // Need selection for link
      // §298 §12-9b (design §5c): prompt dialog = unbounded async gap.
      const task = registerEditorMutationTask(editor.view);
      showPrompt("Enter URL:").then((url) => {
        const live = task.isLive();
        task.finish();
        if (url && live) {
          chainWithVimExternalEdit(editor)
            .focus()
            .toggleLink({ href: url })
            .run();
        }
      });
      break;
    }
    case "insert_math_block":
      chainWithVimExternalEdit(editor)?.focus().setMathBlock().run();
      break;

    case "insert_mermaid":
      chainWithVimExternalEdit(editor)?.setMermaidBlock().run();
      break;
    case "insert_ordered_list":
      chainWithVimExternalEdit(editor)?.focus().toggleOrderedList().run();
      break;
    case "insert_paragraph":
      chainWithVimExternalEdit(editor)?.focus().setNode("paragraph").run();
      break;
    case "insert_query_block":
      chainWithVimExternalEdit(editor)?.setQueryBlock().run();
      break;

    case "insert_strikethrough":
      chainWithVimExternalEdit(editor)?.focus().toggleStrike().run();
      break;

    case "insert_subscript":
      chainWithVimExternalEdit(editor)?.focus().toggleSubscript().run();
      break;
    case "insert_superscript":
      chainWithVimExternalEdit(editor)?.focus().toggleSuperscript().run();
      break;
    case "insert_table":
      chainWithVimExternalEdit(editor)
        ?.focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
      break;
    case "insert_task_list":
      chainWithVimExternalEdit(editor)?.focus().toggleTaskList().run();
      break;
    case "insert_toc":
      chainWithVimExternalEdit(editor)?.insertTableOfContents().run();
      break;
    case "insert_toggle":
      chainWithVimExternalEdit(editor)?.setToggle().run();
      break;
    case "insert_underline":
      chainWithVimExternalEdit(editor)?.focus().toggleUnderline().run();
      break;
    case "insert_unordered_list":
      chainWithVimExternalEdit(editor)?.focus().toggleBulletList().run();
      break;
    // --- Insert menu: inline element handlers ---
    case "insert_wikilink":
      chainWithVimExternalEdit(editor)?.focus().insertContent("[[]]").run();
      break;
  }
}

/** In source mode the document is out of sight, so an Insert command says why it did nothing. */
export function sayInsertNeedsTheDocument(): void {
  const locale = useSettingsStore.getState().locale as Locale;
  useUIStore
    .getState()
    .showToast(t("sourceMode.insertUnavailable", locale), "info");
}
