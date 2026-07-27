import { open } from "@tauri-apps/plugin-dialog";

import type { SlashMenuItem } from "../../components/command/SlashMenu";
import type { Editor } from "@tiptap/core";

import { createDir, importFile } from "../../ipc/invoke";
import { useAIStore } from "../../stores/ai/ai";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import {
  AI_EXPAND,
  AI_EXPLAIN,
  AI_FIX_GRAMMAR,
  AI_SUMMARIZE,
  AI_TRANSLATE,
} from "../../utils/ai-command-prompts";
import {
  executeAICommand,
  getSelectionOrParagraph,
  showPrompt,
} from "../../utils/ai-commands";
import {
  resolveInputVariable,
  substituteInput,
  substituteVariables,
} from "../../utils/custom-ai-commands";
import { registerEditorMutationTask } from "../../utils/editor/mutation-tasks";
import { showFieldDialog } from "../../utils/field-dialog";
import {
  generatePhotoFilename,
  getAssetsDir,
} from "../../utils/journal/journal-photo";
import { showTableGridPicker } from "../../utils/table-grid-picker";
import { chainWithVimExternalEdit } from "./vim/vim-keys";

export function buildSlashItems(editor: Editor): SlashMenuItem[] {
  const items: SlashMenuItem[] = [
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
    // Rich content
    {
      id: "code-block",
      label: "Code Block",
      category: "Rich Content",
      description: "Syntax highlighted code",
      mdHint: "```",
      action: () =>
        chainWithVimExternalEdit(editor).focus().toggleCodeBlock().run(),
    },
    {
      id: "math-block",
      label: "Math Block",
      category: "Rich Content",
      description: "LaTeX math equation",
      mdHint: "$$",
      action: () =>
        chainWithVimExternalEdit(editor)
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
      action: () => chainWithVimExternalEdit(editor).setMermaidBlock().run(),
    },
    {
      id: "svg",
      label: "SVG Image",
      category: "Rich Content",
      description: "Render raw SVG markup",
      mdHint: "```svg",
      action: () => chainWithVimExternalEdit(editor).setSvgBlock().run(),
    },
    {
      id: "html",
      label: "HTML Block",
      category: "Rich Content",
      description: "Embed raw HTML (sanitized)",
      mdHint: "<div>",
      action: () => chainWithVimExternalEdit(editor).setHtmlBlock().run(),
    },
    {
      id: "query",
      label: "Query",
      category: "Rich Content",
      description: "Dynamic query block",
      mdHint: "```query",
      action: () => chainWithVimExternalEdit(editor).setQueryBlock().run(),
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
        // §12-9b: picker resolution is an unbounded async gap (design §5c)
        const task = registerEditorMutationTask(editor.view);
        const result = await showTableGridPicker(
          coords.left,
          coords.bottom + 4,
        );
        const live = task.isLive();
        task.finish();
        if (!result || !live) return;
        chainWithVimExternalEdit(editor)
          .focus()
          .insertTable({
            rows: result.rows,
            cols: result.cols,
            withHeaderRow: true,
          })
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
        const task = registerEditorMutationTask(editor.view); // §12-9b dialog gap
        const result = await showFieldDialog({
          title: "Insert Image",
          fields: [
            { key: "alt", label: "Alt text", placeholder: "Image description" },
            {
              key: "src",
              label: "Image URL",
              placeholder: "https://... or ./path.png",
            },
          ],
        });
        const live = task.isLive();
        task.finish();
        if (!result?.src || !live) return;
        chainWithVimExternalEdit(editor)
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
        const task = registerEditorMutationTask(editor.view); // §12-9b dialog gap
        const result = await showFieldDialog({
          title: "Insert Link",
          fields: [
            { key: "text", label: "Text", placeholder: "Display text" },
            { key: "url", label: "URL", placeholder: "https://..." },
          ],
        });
        const live = task.isLive();
        task.finish();
        if (!result?.url || !live) return;
        const text = result.text || result.url;
        chainWithVimExternalEdit(editor)
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
        chainWithVimExternalEdit(editor).insertFootnoteRef(nextId).run();
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

  // §11.8 Smart Template
  items.push({
    id: "ai-template",
    label: "AI Template",
    category: "AI",
    description: "Generate from a smart template",
    mdHint: "AI",
    action: () => {
      useUIStore.getState().toggleSmartTemplateDialog();
    },
  });

  // §99 Quick Capture — fleeting note into the Zettelkasten inbox
  items.push(
    {
      id: "quick-capture",
      label: "Quick Capture",
      category: "Journal",
      description: "Capture a fleeting note to the Zettel inbox",
      mdHint: "/capture",
      action: () => useUIStore.getState().openQuickCapture(),
    },
    {
      id: "photo",
      label: "Insert Photo",
      category: "Journal",
      description: "Insert photo from file picker",
      mdHint: "📷",
      action: async () => {
        // §12-9c (design §5c): bind BEFORE the dialog. Reading the store
        // afterwards would re-bind the photo to whichever tab is active when
        // the picker closes — and with no task registered during the dialog,
        // a state install in that window has nothing to invalidate, so the
        // insert would land in the wrong document (and resolve the journal
        // assets dir from the wrong file).
        const task = registerEditorMutationTask(editor.view);
        const activeTabId = useEditorStore.getState().activeTabId;
        const tabs = useEditorStore.getState().tabs;
        const activeTab = tabs.find(
          (t: { id: string }) => t.id === activeTabId,
        );
        const filePath = activeTab?.filePath ?? "";
        const rootPath = useFileStore.getState().rootPath ?? "";
        const journalDir = useSettingsStore.getState().journalDirectory ?? "";
        const journalAbsPath =
          rootPath && journalDir ? `${rootPath}/${journalDir}` : "";
        const isJournal = journalAbsPath && filePath.startsWith(journalAbsPath);

        try {
          const selected = await open({
            multiple: true,
            filters: [
              {
                name: "Images",
                extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"],
              },
            ],
          });
          if (!selected || !task.isLive()) return;

          const paths = Array.isArray(selected) ? selected : [selected];

          {
            for (const p of paths) {
              if (!task.isLive()) return;
              if (isJournal && rootPath && journalDir) {
                // Copy file to assets directory using helpers + copyFile IPC
                const now = new Date();
                const fileName = p.split("/").pop() ?? "photo.jpg";
                const assetsRelDir = getAssetsDir(journalDir, now);
                const absoluteAssetsDir = `${rootPath}/${assetsRelDir}`;

                try {
                  await createDir(absoluteAssetsDir);
                } catch {
                  /* already exists */
                }
                // createDir is an async gap of its own: without this check a
                // task that died here would still copy the photo into the
                // PREVIOUS document's journal assets dir, leaving a file
                // nothing references.
                if (!task.isLive()) return;

                const destName = generatePhotoFilename(fileName, now);
                const absoluteDest = `${absoluteAssetsDir}/${destName}`;
                const relativePath = `${assetsRelDir}/${destName}`;

                await importFile(p, absoluteDest);
                if (!task.isLive()) return;

                chainWithVimExternalEdit(editor)
                  .focus()
                  .insertContent({
                    type: "image",
                    attrs: {
                      src: relativePath,
                      alt: fileName.replace(/\.[^.]+$/, ""),
                      title: "",
                    },
                  })
                  .run();
              } else {
                // Non-journal: insert with absolute path
                chainWithVimExternalEdit(editor)
                  .focus()
                  .insertContent({
                    type: "image",
                    attrs: { src: p, alt: p.split("/").pop() ?? "", title: "" },
                  })
                  .run();
              }
            }
          }
        } catch {
          // Dialog cancelled or error
        } finally {
          // Covers the cancelled-dialog and thrown-dialog paths too — the
          // task is registered before open(), so every exit must close it.
          task.finish();
        }
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
      description:
        cmd.prompt.length > 60 ? cmd.prompt.slice(0, 60) + "..." : cmd.prompt,
      mdHint: "AI",
      action: async () => {
        // Get current context for variable substitution
        const { from, to } = editor.state.selection;
        const selection =
          from !== to ? editor.state.doc.textBetween(from, to) : "";
        const document = editor.state.doc.textContent;

        const { hasInput, prompt: inputPrompt } = resolveInputVariable(
          cmd.prompt,
        );

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
        executeAICommand(
          editor,
          finalPrompt,
          "You are a helpful AI assistant. Follow the user's instructions carefully.",
        );
      },
    });
  }

  return items;
}
