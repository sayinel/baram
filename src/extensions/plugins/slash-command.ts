// §4.6 Slash Commands — Tiptap Extension using Suggestion API
import { Extension } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import {
  SlashMenuList,
  type SlashMenuItem,
  type SlashMenuRef,
} from "../../components/command/SlashMenu";
import { useAIStore } from "../../stores/ai-store";
import {
  substituteVariables,
  resolveInputVariable,
  substituteInput,
} from "../../utils/custom-ai-commands";
import { executeAICommand, getSelectionOrParagraph, showPrompt } from "../../utils/ai-commands";
import { showFieldDialog } from "../../utils/field-dialog";
import { showTableGridPicker } from "../../utils/table-grid-picker";
import {
  AI_TRANSLATE,
  AI_SUMMARIZE,
  AI_EXPAND,
  AI_FIX_GRAMMAR,
  AI_EXPLAIN,
} from "../../utils/ai-command-prompts";

export function buildSlashItems(editor: Editor): SlashMenuItem[] {
  const items: SlashMenuItem[] = [
    // Headings
    {
      id: "h1",
      label: "Heading 1",
      category: "Basic",
      description: "Large heading",
      mdHint: "#",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: "h2",
      label: "Heading 2",
      category: "Basic",
      description: "Medium heading",
      mdHint: "##",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      id: "h3",
      label: "Heading 3",
      category: "Basic",
      description: "Small heading",
      mdHint: "###",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    // Lists
    {
      id: "bullet-list",
      label: "Bullet List",
      category: "Basic",
      description: "Unordered list",
      mdHint: "-",
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      id: "ordered-list",
      label: "Ordered List",
      category: "Basic",
      description: "Numbered list",
      mdHint: "1.",
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "task-list",
      label: "Task List",
      category: "Basic",
      description: "Checkbox list",
      mdHint: "- [ ]",
      action: () => editor.chain().focus().toggleTaskList().run(),
    },
    // Block elements
    {
      id: "blockquote",
      label: "Blockquote",
      category: "Basic",
      description: "Quote block",
      mdHint: ">",
      action: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "horizontal-rule",
      label: "Horizontal Rule",
      category: "Basic",
      description: "Divider line",
      mdHint: "---",
      action: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      id: "callout",
      label: "Callout",
      category: "Basic",
      description: "Callout block (tip, warning, …)",
      mdHint: "> [!",
      action: () => editor.commands.setCallout({ type: "info" }),
    },
    {
      id: "toggle",
      label: "Toggle",
      category: "Basic",
      description: "Collapsible details block",
      mdHint: "<details>",
      action: () => editor.commands.setToggle(),
    },
    {
      id: "toggle-heading-1",
      label: "Toggle Heading 1",
      category: "Basic",
      description: "Collapsible heading 1",
      mdHint: "# ▸",
      action: () =>
        editor.commands.setToggle({ summaryType: "heading", level: 1 }),
    },
    {
      id: "toggle-heading-2",
      label: "Toggle Heading 2",
      category: "Basic",
      description: "Collapsible heading 2",
      mdHint: "## ▸",
      action: () =>
        editor.commands.setToggle({ summaryType: "heading", level: 2 }),
    },
    {
      id: "toggle-heading-3",
      label: "Toggle Heading 3",
      category: "Basic",
      description: "Collapsible heading 3",
      mdHint: "### ▸",
      action: () =>
        editor.commands.setToggle({ summaryType: "heading", level: 3 }),
    },
    {
      id: "toc",
      label: "Table of Contents",
      category: "Basic",
      description: "Auto-generated heading list",
      mdHint: "[TOC]",
      action: () => editor.commands.insertTableOfContents(),
    },
    {
      id: "definition-list",
      label: "Definition List",
      category: "Basic",
      description: "Term-definition list",
      mdHint: ": ",
      action: () => editor.commands.setDefinitionList(),
    },
    // Rich content
    {
      id: "code-block",
      label: "Code Block",
      category: "Rich Content",
      description: "Syntax highlighted code",
      mdHint: "```",
      action: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: "math-block",
      label: "Math Block",
      category: "Rich Content",
      description: "LaTeX math equation",
      mdHint: "$$",
      action: () =>
        editor
          .chain()
          .focus()
          .insertContent({ type: "mathBlock", attrs: { formula: "" } })
          .run(),
    },
    {
      id: "mermaid",
      label: "Mermaid Diagram",
      category: "Rich Content",
      description: "Flowchart, sequence, and more",
      mdHint: "```mermaid",
      action: () => editor.commands.setMermaidBlock(),
    },
    {
      id: "table",
      label: "Table",
      category: "Rich Content",
      description: "Insert a table (grid picker)",
      mdHint: "| | |",
      action: async () => {
        // Get cursor position for picker placement
        const { from } = editor.state.selection;
        const coords = editor.view.coordsAtPos(from);
        const result = await showTableGridPicker(coords.left, coords.bottom + 4);
        if (!result) return;
        editor
          .chain()
          .focus()
          .insertTable({ rows: result.rows, cols: result.cols, withHeaderRow: true })
          .run();
      },
    },
    // Media & Inline
    {
      id: "image",
      label: "Image",
      category: "Media",
      description: "Insert an image",
      mdHint: "![](url)",
      action: async () => {
        const result = await showFieldDialog({
          title: "Insert Image",
          fields: [
            { key: "alt", label: "Alt text", placeholder: "Image description" },
            { key: "src", label: "Image URL", placeholder: "https://... or ./path.png" },
          ],
        });
        if (!result?.src) return;
        editor
          .chain()
          .focus()
          .insertContent({
            type: "image",
            attrs: { src: result.src, alt: result.alt || "", title: "" },
          })
          .run();
      },
    },
    {
      id: "link",
      label: "Link",
      category: "Media",
      description: "Insert a hyperlink",
      mdHint: "[text](url)",
      action: async () => {
        const result = await showFieldDialog({
          title: "Insert Link",
          fields: [
            { key: "text", label: "Text", placeholder: "Display text" },
            { key: "url", label: "URL", placeholder: "https://..." },
          ],
        });
        if (!result?.url) return;
        const text = result.text || result.url;
        editor
          .chain()
          .focus()
          .insertContent({
            type: "text",
            text,
            marks: [{ type: "link", attrs: { href: result.url } }],
          })
          .run();
      },
    },
    // §footnote Footnote
    {
      id: "footnote",
      label: "Footnote",
      category: "Advanced",
      description: "Insert footnote reference",
      mdHint: "[^1]",
      action: () => {
        // Calculate next available numeric footnote identifier
        let maxId = 0;
        editor.state.doc.descendants((node) => {
          if (node.type.name === "footnoteRef") {
            const id = parseInt(node.attrs.identifier as string, 10);
            if (!isNaN(id) && id > maxId) maxId = id;
          }
        });
        const nextId = String(maxId + 1);
        editor.commands.insertFootnoteRef(nextId);
      },
    },
  ];

  // §6.2 Built-in AI slash commands
  items.push(
    {
      id: "ai-write",
      label: "AI Write",
      category: "AI",
      description: "Generate a draft from a topic",
      mdHint: "AI",
      action: async () => {
        const topic = await showPrompt("Topic or instructions:");
        if (!topic) return;
        executeAICommand(
          editor,
          topic,
          "You are a writing assistant. Write a draft about the given topic in markdown. Output only the markdown content, no explanations.",
        );
      },
    },
    {
      id: "ai-brainstorm",
      label: "AI Brainstorm",
      category: "AI",
      description: "Generate a list of ideas",
      mdHint: "AI",
      action: async () => {
        const topic = await showPrompt("Topic to brainstorm:");
        if (!topic) return;
        executeAICommand(
          editor,
          topic,
          "You are a creative assistant. Generate a brainstormed list of ideas about the given topic. Output as a markdown bullet list.",
        );
      },
    },
    {
      id: "ai-translate",
      label: "AI Translate",
      category: "AI",
      description: "Translate text",
      mdHint: "AI",
      action: async () => {
        const text = getSelectionOrParagraph(editor);
        const lang = await showPrompt("Target language:", "", {
          presets: ["English", "Korean"],
        });
        if (!lang) return;
        executeAICommand(
          editor,
          text,
          AI_TRANSLATE.replace("{language}", lang),
        );
      },
    },
    {
      id: "ai-summarize",
      label: "AI Summarize",
      category: "AI",
      description: "Summarize text",
      mdHint: "AI",
      action: () => {
        const text = getSelectionOrParagraph(editor);
        executeAICommand(editor, text, AI_SUMMARIZE);
      },
    },
    {
      id: "ai-expand",
      label: "AI Expand",
      category: "AI",
      description: "Expand with more detail",
      mdHint: "AI",
      action: () => {
        const text = getSelectionOrParagraph(editor);
        executeAICommand(editor, text, AI_EXPAND);
      },
    },
    {
      id: "ai-fix-grammar",
      label: "AI Fix Grammar",
      category: "AI",
      description: "Fix grammar & spelling",
      mdHint: "AI",
      action: () => {
        const text = getSelectionOrParagraph(editor);
        executeAICommand(editor, text, AI_FIX_GRAMMAR);
      },
    },
    {
      id: "ai-explain",
      label: "AI Explain",
      category: "AI",
      description: "Explain in simple terms",
      mdHint: "AI",
      action: () => {
        const text = getSelectionOrParagraph(editor);
        executeAICommand(editor, text, AI_EXPLAIN);
      },
    },
  );

  // §48 Inject custom AI commands from store
  const customCommands = useAIStore.getState().customCommands;
  for (const cmd of customCommands) {
    items.push({
      id: `ai-custom-${cmd.id}`,
      label: cmd.name,
      category: "AI",
      description: cmd.prompt.length > 60 ? cmd.prompt.slice(0, 60) + "..." : cmd.prompt,
      mdHint: "AI",
      action: async () => {
        // Get current context for variable substitution
        const { from, to } = editor.state.selection;
        const selection = from !== to ? editor.state.doc.textBetween(from, to) : "";
        const document = editor.state.doc.textContent;

        const { hasInput, prompt: inputPrompt } = resolveInputVariable(cmd.prompt);

        let finalPrompt = substituteVariables(cmd.prompt, {
          selection,
          document,
        });

        if (hasInput) {
          const userInput = await showPrompt(inputPrompt);
          if (userInput === null) return; // Cancelled
          finalPrompt = substituteInput(finalPrompt, userInput);
        }

        // Stream LLM response into editor
        executeAICommand(editor, finalPrompt, "You are a helpful AI assistant. Follow the user's instructions carefully.");
      },
    });
  }

  return items;
}

const SLASH_MENU_HEIGHT = 320; // approximate max popup height

function positionPopup(popup: HTMLDivElement, coords: DOMRect) {
  const spaceBelow = window.innerHeight - coords.bottom - 4;
  popup.style.left = `${coords.left}px`;
  if (spaceBelow < SLASH_MENU_HEIGHT) {
    // Not enough room below — position above the cursor
    popup.style.top = `${coords.top - SLASH_MENU_HEIGHT - 4}px`;
  } else {
    popup.style.top = `${coords.bottom + 4}px`;
  }
}

export const SlashCommands = Extension.create({
  name: "slashCommands",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      Suggestion({
        editor,
        char: "/",
        startOfLine: true,
        command: ({
          editor: ed,
          range,
          props,
        }: {
          editor: Editor;
          range: { from: number; to: number };
          props: SlashMenuItem;
        }) => {
          ed.chain().focus().deleteRange(range).run();
          props.action();
        },
        items: ({ query }: { query: string }) => {
          const items = buildSlashItems(editor);
          if (!query) return items;
          const q = query.toLowerCase();
          return items.filter(
            (item) =>
              item.id.toLowerCase().includes(q) ||
              item.label.toLowerCase().includes(q) ||
              item.category.toLowerCase().includes(q) ||
              item.description.toLowerCase().includes(q) ||
              (item.mdHint ?? "").toLowerCase().includes(q),
          );
        },
        render: () => {
          let component: ReactRenderer<SlashMenuRef> | null = null;
          let popup: HTMLDivElement | null = null;

          return {
            onStart: (props: SuggestionProps) => {
              component = new ReactRenderer(SlashMenuList, {
                props: {
                  items: props.items as SlashMenuItem[],
                  command: props.command,
                },
                editor: props.editor,
              });

              popup = document.createElement("div");
              popup.className = "slash-menu-popup";
              document.body.appendChild(popup);
              popup.appendChild(component.element);

              const coords = props.clientRect?.();
              if (coords && popup) {
                positionPopup(popup, coords);
              }
            },
            onUpdate: (props: SuggestionProps) => {
              component?.updateProps({
                items: props.items as SlashMenuItem[],
                command: props.command,
              });

              const coords = props.clientRect?.();
              if (coords && popup) {
                positionPopup(popup, coords);
              }
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === "Escape") {
                popup?.remove();
                component?.destroy();
                popup = null;
                component = null;
                return true;
              }
              return component?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              popup?.remove();
              component?.destroy();
              popup = null;
              component = null;
            },
          };
        },
      }),
    ];
  },
});
