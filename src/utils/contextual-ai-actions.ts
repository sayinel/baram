// §11.2.3 Contextual AI Toolbar — mode-specific AI action definitions
import type { ContentMode } from "./content-type-detector";

export interface AIAction {
  id: string;
  label: string;
  systemPrompt: string;
}

const TEXT_ACTIONS: AIAction[] = [
  {
    id: "improve",
    label: "Improve",
    systemPrompt:
      "Improve the following text for clarity, grammar, and flow. Output only the improved text.",
  },
  {
    id: "shorten",
    label: "Shorten",
    systemPrompt:
      "Make the following text more concise while preserving meaning. Output only the shortened text.",
  },
  {
    id: "expand",
    label: "Expand",
    systemPrompt:
      "Expand the following text with more detail and explanation. Output only the expanded text.",
  },
  {
    id: "translate",
    label: "Translate",
    systemPrompt:
      "Translate the following text to {language}. Output only the translation.",
  },
  {
    id: "tone",
    label: "Tone Change",
    systemPrompt:
      "Rewrite the following text in a {tone} tone. Output only the rewritten text.",
  },
  {
    id: "explain",
    label: "Explain",
    systemPrompt:
      "Explain the following text in simple terms. Output only the explanation.",
  },
];

const CODE_ACTIONS: AIAction[] = [
  {
    id: "add-comments",
    label: "Add Comments",
    systemPrompt:
      "Add clear, concise comments to the following code. Output only the commented code.",
  },
  {
    id: "optimize",
    label: "Optimize",
    systemPrompt:
      "Optimize the following code for performance and readability. Output only the optimized code.",
  },
  {
    id: "find-bugs",
    label: "Find Bugs",
    systemPrompt:
      "Analyze the following code for potential bugs and issues. List each bug with explanation.",
  },
  {
    id: "convert-lang",
    label: "Convert",
    systemPrompt:
      "Convert the following code to {language}. Output only the converted code.",
  },
  {
    id: "gen-tests",
    label: "Generate Tests",
    systemPrompt:
      "Generate unit tests for the following code. Output only the test code.",
  },
];

const MATH_ACTIONS: AIAction[] = [
  {
    id: "solve-steps",
    label: "Show Steps",
    systemPrompt:
      "Show step-by-step solution for the following LaTeX expression.",
  },
  {
    id: "fix-latex",
    label: "Fix LaTeX",
    systemPrompt:
      "Fix any LaTeX syntax errors in the following expression. Output only corrected LaTeX.",
  },
  {
    id: "explain-math",
    label: "Explain",
    systemPrompt:
      "Explain the following mathematical expression in plain language.",
  },
  {
    id: "related-formulas",
    label: "Related Formulas",
    systemPrompt:
      "List related formulas and identities for the following expression.",
  },
];

const TABLE_ACTIONS: AIAction[] = [
  {
    id: "analyze-data",
    label: "Analyze Data",
    systemPrompt:
      "Analyze the following markdown table data and provide insights.",
  },
  {
    id: "fill-cells",
    label: "Fill Cells",
    systemPrompt:
      "Fill in empty cells in the following table based on patterns in existing data.",
  },
  {
    id: "suggest-rows",
    label: "Suggest Rows",
    systemPrompt: "Suggest additional rows or columns for the following table.",
  },
  {
    id: "to-csv",
    label: "To CSV",
    systemPrompt: "Convert the following markdown table to CSV format.",
  },
];

const STRUCTURE_ACTIONS: AIAction[] = [
  {
    id: "gen-toc",
    label: "Generate TOC",
    systemPrompt:
      "Generate a table of contents for the following document structure.",
  },
  {
    id: "improve-structure",
    label: "Improve Structure",
    systemPrompt: "Suggest improvements to the document structure.",
  },
  {
    id: "split-sections",
    label: "Split Sections",
    systemPrompt: "Suggest how to split this content into separate sections.",
  },
  {
    id: "summarize",
    label: "Summarize",
    systemPrompt: "Summarize the following document section.",
  },
];

const MODE_ACTIONS: Record<ContentMode, AIAction[]> = {
  text: TEXT_ACTIONS,
  code: CODE_ACTIONS,
  math: MATH_ACTIONS,
  table: TABLE_ACTIONS,
  structure: STRUCTURE_ACTIONS,
};

export function getActionsForMode(mode: ContentMode): AIAction[] {
  return MODE_ACTIONS[mode];
}
