import type { SlashMenuItem } from "../../components/command/SlashMenu";
import type { Editor } from "@tiptap/core";

import { chainWithVimExternalEdit } from "./vim/vim-keys";

export function buildBasicItems(editor: Editor): SlashMenuItem[] {
  return [
    // Headings
    {
      id: "h1",
      label: "Heading 1",
      category: "Basic",
      description: "Large heading",
      mdHint: "#",
      action: () =>
        chainWithVimExternalEdit(editor)
          .focus()
          .toggleHeading({ level: 1 })
          .run(),
    },
    {
      id: "h2",
      label: "Heading 2",
      category: "Basic",
      description: "Medium heading",
      mdHint: "##",
      action: () =>
        chainWithVimExternalEdit(editor)
          .focus()
          .toggleHeading({ level: 2 })
          .run(),
    },
    {
      id: "h3",
      label: "Heading 3",
      category: "Basic",
      description: "Small heading",
      mdHint: "###",
      action: () =>
        chainWithVimExternalEdit(editor)
          .focus()
          .toggleHeading({ level: 3 })
          .run(),
    },
    // Lists
    {
      id: "bullet-list",
      label: "Unordered List",
      category: "Basic",
      description: "Unordered list",
      mdHint: "-",
      action: () =>
        chainWithVimExternalEdit(editor).focus().toggleBulletList().run(),
    },
    {
      id: "ordered-list",
      label: "Ordered List",
      category: "Basic",
      description: "Numbered list",
      mdHint: "1.",
      action: () =>
        chainWithVimExternalEdit(editor).focus().toggleOrderedList().run(),
    },
    {
      id: "task-list",
      label: "Task List",
      category: "Basic",
      description: "Checkbox list",
      mdHint: "- [ ]",
      action: () =>
        chainWithVimExternalEdit(editor).focus().toggleTaskList().run(),
    },
    // Block elements
    {
      id: "blockquote",
      label: "Blockquote",
      category: "Basic",
      description: "Quote block",
      mdHint: ">",
      action: () =>
        chainWithVimExternalEdit(editor).focus().toggleBlockquote().run(),
    },
    {
      id: "horizontal-rule",
      label: "Horizontal Rule",
      category: "Basic",
      description: "Divider line",
      mdHint: "---",
      action: () =>
        chainWithVimExternalEdit(editor).focus().setHorizontalRule().run(),
    },
    {
      id: "callout",
      label: "Callout",
      category: "Basic",
      description: "Callout block (tip, warning, …)",
      mdHint: "> [!",
      action: () =>
        chainWithVimExternalEdit(editor).setCallout({ type: "info" }).run(),
    },
    {
      id: "toggle",
      label: "Toggle",
      category: "Basic",
      description: "Collapsible details block",
      mdHint: "<details>",
      action: () => chainWithVimExternalEdit(editor).setToggle().run(),
    },
    {
      id: "toggle-heading-1",
      label: "Toggle Heading 1",
      category: "Basic",
      description: "Collapsible heading 1",
      mdHint: "# ▸",
      action: () =>
        chainWithVimExternalEdit(editor)
          .setToggle({ summaryType: "heading", level: 1 })
          .run(),
    },
    {
      id: "toggle-heading-2",
      label: "Toggle Heading 2",
      category: "Basic",
      description: "Collapsible heading 2",
      mdHint: "## ▸",
      action: () =>
        chainWithVimExternalEdit(editor)
          .setToggle({ summaryType: "heading", level: 2 })
          .run(),
    },
    {
      id: "toggle-heading-3",
      label: "Toggle Heading 3",
      category: "Basic",
      description: "Collapsible heading 3",
      mdHint: "### ▸",
      action: () =>
        chainWithVimExternalEdit(editor)
          .setToggle({ summaryType: "heading", level: 3 })
          .run(),
    },
    {
      id: "toc",
      label: "Table of Contents",
      category: "Basic",
      description: "Auto-generated heading list",
      mdHint: "[TOC]",
      action: () =>
        chainWithVimExternalEdit(editor).insertTableOfContents().run(),
    },
    {
      id: "definition-list",
      label: "Definition List",
      category: "Basic",
      description: "Term-definition list",
      mdHint: ": ",
      action: () => chainWithVimExternalEdit(editor).setDefinitionList().run(),
    },
  ];
}
