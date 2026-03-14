// §11.2.3 AI Action Dispatcher — shared logic for BlockHandle & NodeView AI menus
// Eliminates duplicated placeholder handling (translate, tone, convert-lang, etc.)

import type { AIAction } from "./contextual-ai-actions";
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

import { executeAICommand, showPrompt } from "./ai-commands";
import { executeBlockAIWithDiff } from "./block-ai-diff";
import { getBlockRawContent, getBlockTextContent } from "./block-ai-utils";

/**
 * Dispatch an AI action for a specific block node.
 * Handles placeholder resolution, mode-based routing, and execution.
 *
 * @param action   The AI action definition
 * @param editor   Tiptap editor instance
 * @param targetPos Position of the target block in the document
 */
export function dispatchAIAction(
  action: AIAction,
  editor: Editor,
  targetPos: number,
): void {
  const node = editor.state.doc.nodeAt(targetPos);
  if (!node) return;

  const blockText = getBlockTextContent(node);
  if (!blockText.trim()) return;

  // Resolve placeholder and execute
  void resolveAndExecute(action, editor, targetPos, node, blockText);
}

/**
 * Dispatch a custom instruction for a specific block.
 * Always uses generate mode (insert after block).
 */
export function dispatchCustomInstruction(
  editor: Editor,
  targetPos: number,
): void {
  const node = editor.state.doc.nodeAt(targetPos);
  if (!node) return;

  const blockText = getBlockTextContent(node);
  if (!blockText.trim()) return;

  void showPrompt("Custom instruction:").then((instruction) => {
    if (!instruction) return;
    const afterPos = targetPos + node.nodeSize;
    executeAICommand(editor, blockText, instruction, {
      insertAfterPos: afterPos,
    });
  });
}

// ── Internal ────────────────────────────────────────────────────────

async function resolveAndExecute(
  action: AIAction,
  editor: Editor,
  targetPos: number,
  node: PmNode,
  blockText: string,
): Promise<void> {
  // Resolve placeholders in systemPrompt via user prompt
  const systemPrompt = await resolveSystemPrompt(action);
  if (!systemPrompt) return; // user cancelled

  if (action.mode === "replace") {
    const rawContent = getBlockRawContent(node);
    await executeBlockAIWithDiff(
      editor,
      targetPos,
      rawContent,
      blockText,
      systemPrompt,
    );
  } else {
    // Generate mode: insert after the target block
    const afterPos = targetPos + node.nodeSize;
    executeAICommand(editor, blockText, systemPrompt, {
      insertAfterPos: afterPos,
    });
  }
}

/**
 * Resolve placeholder tokens in the action's systemPrompt.
 * Returns the resolved prompt, or null if the user cancelled.
 */
async function resolveSystemPrompt(action: AIAction): Promise<null | string> {
  if (action.id === "translate") {
    const lang = await showPrompt("Target language:", "", {
      presets: ["English", "Korean"],
    });
    return lang ? action.systemPrompt.replace("{language}", lang) : null;
  }

  if (action.id === "tone") {
    const tone = await showPrompt("Select tone:", "", {
      presets: ["Formal", "Casual", "Professional", "Friendly"],
    });
    return tone ? action.systemPrompt.replace("{tone}", tone) : null;
  }

  if (action.id === "convert-lang") {
    const lang = await showPrompt("Target language:", "", {
      presets: ["Python", "JavaScript", "TypeScript", "Rust"],
    });
    return lang ? action.systemPrompt.replace("{language}", lang) : null;
  }

  if (action.id === "convert-diagram") {
    const dtype = await showPrompt("Target diagram type:", "", {
      presets: [
        "flowchart",
        "sequence",
        "classDiagram",
        "stateDiagram",
        "erDiagram",
      ],
    });
    return dtype ? action.systemPrompt.replace("{diagramType}", dtype) : null;
  }

  return action.systemPrompt;
}
