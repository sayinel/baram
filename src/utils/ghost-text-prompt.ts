// §43 Ghost Text — Context-aware prompt builder
// D1: Block-type-specific prompts (code, math, skills, text)
// D2: Fill-in-the-Middle (FIM) — includes suffix context after cursor
// Tier 1: Current paragraph text before cursor
// Tier 2: Previous 2 paragraphs for context
// Tier 3: Document title (first heading)

import type { Editor } from "@tiptap/core";

import { useAIStore } from "../stores/ai-store";
import { useEditorStore } from "../stores/editor-store";
import { useFileStore } from "../stores/file-store";

/** Configuration returned by buildGhostTextConfig */
export interface GhostTextConfig {
  /** User prompt with context */
  contextText: string;
  /** If true, ghost text should be skipped entirely */
  skip: boolean;
  /** System prompt tailored to the block type */
  systemPrompt: string;
}

/** Build context-aware Ghost Text configuration.
 *  Returns skip=true only for frontmatter (no meaningful completion possible). */
export function buildGhostTextConfig(
  editor: Editor,
  cursorPos: number,
  currentFilePath?: string,
): GhostTextConfig {
  const { state } = editor;
  const $pos = state.doc.resolve(cursorPos);
  const parentType = $pos.parent.type.name;

  // Frontmatter: still skip — YAML key-value completion isn't useful
  if (parentType === "frontmatter") {
    return { skip: true, systemPrompt: "", contextText: "" };
  }

  // --- Text before cursor (Tier 1) ---
  const textBefore = $pos.parent.textBetween(
    0,
    $pos.parentOffset,
    undefined,
    "\ufffc",
  );

  // --- Text after cursor (D2: suffix context, max 500 chars) ---
  const textAfterRaw = $pos.parent.textBetween(
    $pos.parentOffset,
    $pos.parent.content.size,
    undefined,
    "\ufffc",
  );
  const textAfter = textAfterRaw.slice(0, 500);

  // --- Previous blocks (Tier 2) ---
  const prevBlocks: string[] = [];
  const parentNode = $pos.depth > 1 ? $pos.node($pos.depth - 1) : state.doc;
  const currentIndex = $pos.index($pos.depth > 1 ? $pos.depth - 1 : 0);
  let nodesBefore = 0;
  for (let i = currentIndex - 1; i >= 0 && nodesBefore < 2; i--) {
    const child = parentNode.child(i);
    const text = child.textContent;
    if (text.trim()) {
      prevBlocks.unshift(text);
      nodesBefore++;
    }
  }

  // --- Document title (Tier 3) ---
  let title = "";
  state.doc.descendants((node) => {
    if (!title && node.type.name === "heading") {
      title = node.textContent;
      return false;
    }
    return !title;
  });

  // --- Block-type-specific system prompts (D1) ---
  let systemPrompt: string;

  if (parentType === "codeBlock") {
    const lang = getCodeBlockLanguage(editor, cursorPos);
    const langHint = lang ? ` The programming language is ${lang}.` : "";
    systemPrompt = `You are an inline code completion assistant.${langHint} Output ONLY the code that should follow the cursor position. No explanations, no markdown fences, no comments about what the code does. Just the raw code continuation.`;
  } else if (parentType === "mathBlock" || parentType === "mathInline") {
    systemPrompt =
      "You are an inline LaTeX math completion assistant. Output ONLY the LaTeX math continuation. No explanations, no text, no dollar signs. Just the raw LaTeX that should follow.";
  } else if (isSkillsFile(editor)) {
    systemPrompt =
      "You are a prompt/skill file completion assistant. Output ONLY the continuation text that fits the prompt structure (system instructions, user templates, variables). No explanations. Just the raw text continuation.";
  } else {
    systemPrompt =
      "You are an inline text completion assistant. Output ONLY the continuation text. No explanations, no markdown formatting, no quotes. Just the raw text that should follow.";
  }

  // --- Open tab context (D3: Tier 4) ---
  const openTabSummaries = getOpenTabContext(currentFilePath);

  // --- Build user prompt with FIM context (D2) ---
  const parts: string[] = [];
  if (title) parts.push(`Document: "${title}"`);
  if (prevBlocks.length > 0) parts.push(`Context:\n${prevBlocks.join("\n")}`);
  if (openTabSummaries.length > 0)
    parts.push(`Related files:\n${openTabSummaries.join("\n\n")}`);

  if (textAfter.trim()) {
    // FIM pattern: show cursor position between prefix and suffix
    parts.push(
      `Continue this text at the <CURSOR> position:\n${textBefore}<CURSOR>${textAfter}`,
    );
  } else {
    parts.push(`Continue this text: ${textBefore}`);
  }

  return {
    skip: false,
    systemPrompt,
    contextText: parts.join("\n\n"),
  };
}

/** Legacy API — returns just the prompt string (used by existing callers) */
export function buildGhostTextPrompt(
  editor: Editor,
  cursorPos: number,
): string {
  const config = buildGhostTextConfig(editor, cursorPos);
  return config.contextText;
}

/** Get language attribute from a codeBlock node */
function getCodeBlockLanguage(editor: Editor, cursorPos: number): string {
  const $pos = editor.state.doc.resolve(cursorPos);
  const parent = $pos.parent;
  if (parent.type.name === "codeBlock") {
    return (parent.attrs.language as string) || "";
  }
  return "";
}

/** Tier 4: Cross-file context from open tabs (D3).
 *  Returns summaries (filename + first 500 chars) of up to 2 other open files. */
function getOpenTabContext(currentFilePath?: string): string[] {
  const aiStore = useAIStore.getState();
  // Check if cross-file context is enabled (default: true when ghost text enabled)
  if (aiStore.ghostTextCrossFileEnabled === false) return [];

  const editorStore = useEditorStore.getState();
  const fileStore = useFileStore.getState();

  const otherTabs = editorStore.tabs.filter(
    (t) =>
      t.filePath &&
      t.filePath !== currentFilePath &&
      (!t.type || t.type === "file"),
  );

  const summaries: string[] = [];
  for (const tab of otherTabs) {
    if (summaries.length >= 2) break;
    const content = fileStore.openFiles.get(tab.filePath);
    if (content) {
      const snippet = content.slice(0, 500);
      const name = tab.filePath.split("/").pop() || tab.title;
      summaries.push(`[${name}]\n${snippet}`);
    }
  }
  return summaries;
}

/** Detect whether the current document is a Skills file via frontmatter */
function isSkillsFile(editor: Editor): boolean {
  let hasSkillType = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "frontmatter") {
      const text = node.textContent;
      if (/type:\s*skill/i.test(text)) {
        hasSkillType = true;
      }
      return false;
    }
    return !hasSkillType;
  });
  return hasSkillType;
}
