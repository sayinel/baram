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
import { executeAICommand, showPrompt } from "../../utils/ai-commands";

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
      description: "3x3 table with header",
      mdHint: "| | |",
      action: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    // Media & Inline
    {
      id: "image",
      label: "Image",
      category: "Media",
      description: "Insert an image",
      mdHint: "![](url)",
      action: () =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: "image",
            attrs: { src: "", alt: "", title: "" },
          })
          .run(),
    },
    {
      id: "link",
      label: "Link",
      category: "Media",
      description: "Insert a hyperlink",
      mdHint: "[text](url)",
      action: () => {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "text",
            text: "link",
            marks: [{ type: "link", attrs: { href: "" } }],
          })
          .run();
        // Select the inserted "link" text for easy replacement
        const { to } = editor.state.selection;
        editor.chain().setTextSelection({ from: to - 4, to }).run();
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
              item.label.toLowerCase().includes(q) ||
              item.category.toLowerCase().includes(q) ||
              item.description.toLowerCase().includes(q),
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
