import type { SlashMenuItem } from "../../components/command/slash-menu-item";
import type { Editor } from "@tiptap/core";

import { useAIStore } from "../../stores/ai/ai";
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
import { awaitBoundToEditor } from "../../utils/editor/mutation-tasks";

export function buildAIItems(editor: Editor): SlashMenuItem[] {
  const items: SlashMenuItem[] = [];

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

  return items;
}

// §48 Inject custom AI commands from store.
//
// ‼️ These items carry `category: "AI"` so they RENDER inside the AI group in
// the menu — but `buildSlashItems`'s index calls this AFTER `buildJournalItems`
// (see the call-site comment there), not next to `buildAIItems` above. That
// array position is deliberate: it fixes each item's `flatIdx`, and Arrow-key
// traversal walks the flat array, not the rendered/grouped order. Moving this
// call "to tidy it" next to buildAIItems would change which item Down/Up
// lands on without changing anything the user sees in the menu, which is a
// silent behavior change.
export function buildCustomAIItems(editor: Editor): SlashMenuItem[] {
  const items: SlashMenuItem[] = [];
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
