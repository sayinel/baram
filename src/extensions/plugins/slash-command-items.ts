import { open } from "@tauri-apps/plugin-dialog";

import type { SlashMenuItem } from "../../components/command/SlashMenu";
import type { TaskFieldKind } from "../../utils/tasks/task-field-order";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

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
import { focusEditorView } from "../../utils/editor/focus-editor-view";
import {
  awaitBoundToEditor,
  registerEditorMutationTask,
} from "../../utils/editor/mutation-tasks";
import { showFieldDialog } from "../../utils/field-dialog";
import {
  generatePhotoFilename,
  getAssetsDir,
} from "../../utils/journal/journal-photo";
import { classifyMediaSrc } from "../../utils/media-src";
import { showTableGridPicker } from "../../utils/table-grid-picker";
import { extractActionItems } from "../../utils/tasks/extract-action-items";
import {
  askTaskField,
  commitTaskField,
  currentTaskField,
  taskLineTarget,
} from "./task-field-edit";
import { chainWithVimExternalEdit, withVimExternalEdit } from "./vim/vim-keys";

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
        // §12-9b: picker resolution is an unbounded async gap (design §5c) —
        // awaitBoundToEditor guarantees finish() even if the picker rejects
        const result = await awaitBoundToEditor(
          editor.view,
          showTableGridPicker(coords.left, coords.bottom + 4),
        );
        if (!result) return;
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
        // §12-9b dialog gap — awaitBoundToEditor guarantees finish() even if
        // the dialog promise rejects (design §5c).
        const result = await awaitBoundToEditor(
          editor.view,
          showFieldDialog({
            title: "Insert Image",
            fields: [
              {
                key: "alt",
                label: "Alt text",
                placeholder: "Image description",
              },
              {
                key: "src",
                label: "Image URL",
                placeholder: "https://... or ./path.png",
              },
            ],
          }),
        );
        if (!result?.src) return;
        // §297 fix (I-4): the dialog is titled "Insert Image", but the node
        // type must be whatever classifyMediaSrc (§293, the one enumeration)
        // says — every other insertion point in this app (drop, paste, both
        // input rules, both syntax-reveal collapse sites) already asks it
        // first. Without this, typing a .mp4 path into the Image dialog
        // creates an `image` node that classifies as `video` on the next
        // save/reload, so the live and reloaded documents disagree.
        chainWithVimExternalEdit(editor)
          .focus()
          .insertContent({
            type: classifyMediaSrc(result.src) === "image" ? "image" : "video",
            attrs: { src: result.src, alt: result.alt || "", title: "" },
          })
          .run();
      },
    },
    {
      id: "video",
      label: "Video",
      category: "Media",
      description: "Insert a video",
      mdHint: "![](video.mp4)",
      action: async () => {
        // §12-9b dialog gap — awaitBoundToEditor guarantees finish() even if
        // the dialog promise rejects (design §5c).
        const result = await awaitBoundToEditor(
          editor.view,
          showFieldDialog({
            title: "Insert Video",
            fields: [
              { key: "alt", label: "Caption", placeholder: "Video caption" },
              {
                key: "src",
                label: "Video URL or path",
                placeholder: "https://youtu.be/... or ./clip.mp4",
              },
            ],
          }),
        );
        if (!result?.src) return;
        // §297 fix (I-4): mirror of the /image fix above — a src that
        // classifies as `image` (e.g. a .png typed into this dialog) must
        // become an `image` node, or it silently flips to one on reload.
        chainWithVimExternalEdit(editor)
          .focus()
          .insertContent({
            type: classifyMediaSrc(result.src) === "image" ? "image" : "video",
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
        // §12-9b dialog gap — awaitBoundToEditor guarantees finish() even if
        // the dialog promise rejects (design §5c).
        const result = await awaitBoundToEditor(
          editor.view,
          showFieldDialog({
            title: "Insert Link",
            fields: [
              { key: "text", label: "Text", placeholder: "Display text" },
              { key: "url", label: "URL", placeholder: "https://..." },
            ],
          }),
        );
        if (!result?.url) return;
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

  // §308 M3-b 태스크 줄의 필드 — 커서가 태스크 줄에 있을 때만 보인다.
  //
  // 조건부인 것이 요점이다. 언제나 보이면 문단 한가운데서 고른 사용자에게 아무 일도
  // 일어나지 않는 항목이 둘 생기고, 그것은 "눌렀는데 안 된다"로 읽힌다. `buildSlashItems`는
  // 질의마다 다시 불리므로 여기서 지금의 선택을 보면 된다.
  //
  // 여기서 잡은 대상을 **들고 있지 않는** 것도 의도다. 아래 action이 그것을 닫아 쓰면
  // Suggestion이 그 사이에 `/due` 글자를 지우므로 원문이 낡는다(`setTaskFieldFromSlash`
  // 주석). 값을 남기지 않으면 그 실수를 할 자리가 없다.
  if (taskLineTarget(editor.state)) {
    // ‼️ 날짜 셋이 함께 있다. `/due`만 두면 나머지 둘은 `sched:`·`start:` 입력 규칙을
    // 아는 사람만 쓸 수 있는데, 그 규칙을 몰라서 메뉴를 여는 사람이 바로 이 메뉴의
    // 사용자다 — 세 필드가 §303 표에서 같은 자리에 있는 이상 메뉴에서도 같이 있어야 한다.
    items.push(
      ...DATE_FIELDS.map(({ hint, id, kind, label }) => ({
        id,
        label,
        category: "Tasks",
        description: `Pick this task's ${label.toLowerCase()}`,
        mdHint: hint,
        action: () => setTaskFieldFromSlash(editor, kind),
      })),
      {
        id: "priority",
        label: "Priority",
        category: "Tasks",
        description: "Set this task's priority",
        mdHint: "⏫",
        action: () => setTaskFieldFromSlash(editor, "priority"),
      },
      // §18.18 M4 — the ONLY way to reach `cancelled` from the editor. The
      // checkbox cycles todo → doing → done, deliberately leaving cancelled
      // off the ring (utils/tasks/task-state.ts), so without this entry the
      // state would be writable by hand and by nothing else.
      {
        id: "cancel-task",
        label: "Cancel Task",
        category: "Tasks",
        description: "Mark this task cancelled, keeping the line",
        mdHint: "[-]",
        action: () =>
          chainWithVimExternalEdit(editor)
            .focus()
            .setTaskState("cancelled")
            .run(),
      },
    );
  }

  // §314 회의록에서 할 일 뽑기. 태스크 줄 위가 아니라 **어디서나** 쓸 수 있어야 한다 —
  // 뽑는 대상이 태스크가 아니라 그 위의 산문이기 때문이다.
  items.push({
    id: "extract-tasks",
    label: "Extract Action Items",
    category: "Tasks",
    description: "Pull to-dos out of the selection with AI",
    mdHint: "AI",
    action: () => {
      void extractActionItems(editor);
    },
  });

  // §6.2 Built-in AI slash commands
  items.push(
    {
      id: "ai-write",
      label: "AI Write",
      category: "AI",
      description: "Generate a draft from a topic",
      mdHint: "AI",
      action: async () => {
        // §12-9e (design §5c): dialog gap — bind to this document.
        const topic = await awaitBoundToEditor(
          editor.view,
          showPrompt("Topic or instructions:"),
        );
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
        // §12-9e (design §5c): dialog gap — bind to this document.
        const topic = await awaitBoundToEditor(
          editor.view,
          showPrompt("Topic to brainstorm:"),
        );
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
        // §12-9e: `text` above came from THIS document.
        const lang = await awaitBoundToEditor(
          editor.view,
          showPrompt("Target language:", "", {
            presets: ["English", "Korean"],
          }),
        );
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
          // §12-9e: selection/document above are bound to this document.
          const userInput = await awaitBoundToEditor(
            editor.view,
            showPrompt(inputPrompt),
          );
          if (userInput === null) return; // cancelled, or document replaced
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

/**
 * §303 표의 날짜 필드 셋. `id`가 곧 사용자가 치는 말이다(`/due`·`/sched`·`/start`) —
 * 입력 규칙의 트리거(`due:`·`sched:`·`start:`)와 같은 말이라, 메뉴에서 배운 이름을
 * 그대로 빠른 길에 쓸 수 있다.
 */
const DATE_FIELDS: {
  hint: string;
  id: string;
  kind: TaskFieldKind;
  label: string;
}[] = [
  { hint: "📅", id: "due", kind: "due", label: "Due Date" },
  { hint: "⏳", id: "sched", kind: "scheduled", label: "Scheduled Date" },
  { hint: "🛫", id: "start", kind: "start", label: "Start Date" },
];

/**
 * §308 M3-b `/due`·`/sched`·`/start`·`/priority`의 몸통.
 *
 * ‼️ 대상은 **여기서** 다시 잡는다. 메뉴를 지을 때 잡아 두면 그 사이에 Suggestion이
 * `/due` 글자를 지우므로(`slash-command.ts`의 `command`) 캡처한 원문이 낡고, 낙관적
 * 잠금이 매번 걸려 아무것도 쓰이지 않는다.
 */
async function setTaskFieldFromSlash(
  editor: Editor,
  kind: TaskFieldKind,
): Promise<void> {
  const view = editor.view;
  const line = taskLineTarget(view.state);
  if (!line) return;
  // §12-9b dialog gap — 문서가 바뀌었으면 `null`로 돌아온다(design §5c).
  const next = await awaitBoundToEditor(
    view,
    askTaskField(kind, currentTaskField(line.paragraphText, kind)),
  );
  if (next === null) return;
  if (!commitTaskField(view, line, kind, next)) return;

  // ‼️ 커서를 그 줄로 돌려놓는다. 모달이 포커스를 가져갔다가 닫히면 포커스는 `body`로
  // 떨어지고, 사용자는 방금 고친 줄에서 이어 쓰려다 다시 눌러야 한다 — 슬래시 커맨드는
  // **타이핑 중에** 부르는 것이라 그 끊김이 곧 이 명령을 쓰지 않을 이유가 된다.
  // 칩 클릭은 이것을 하지 않는다: 거기서는 커서가 애초에 다른 곳에 있었고, 그 줄로
  // 옮기는 순간 방금 고친 칩이 원문으로 돌아간다.
  focusTaskLineEnd(view, line.paragraphFrom);
}

/** 문단 끝에 커서를 놓고 에디터에 포커스를 준다. */
function focusTaskLineEnd(view: EditorView, paragraphFrom: number): void {
  const { doc } = view.state;
  if (paragraphFrom < 0 || paragraphFrom > doc.content.size) return;
  const $at = doc.resolve(paragraphFrom);
  const end = Math.min($at.end(), doc.content.size);
  view.dispatch(
    withVimExternalEdit(
      view.state.tr.setSelection(TextSelection.create(doc, end)),
    ),
  );
  // bare `view.focus()`는 non-editable 뷰에서 no-op다(CLAUDE.md).
  focusEditorView(view);
}
