// §11.2.3 Contextual AI Toolbar — mode-specific AI action definitions
import type { ContentMode } from "./content-type-detector";

export interface AIAction {
  id: string;
  label: string;
  /** 'replace' → diff preview & replace block content; 'generate' → insert after block */
  mode: "generate" | "replace";
  systemPrompt: string;
}

const TEXT_ACTIONS: AIAction[] = [
  {
    id: "improve",
    label: "Improve",
    mode: "replace",
    systemPrompt:
      "Improve the following text for clarity, grammar, and flow. Output only the improved text.",
  },
  {
    id: "shorten",
    label: "Shorten",
    mode: "replace",
    systemPrompt:
      "Make the following text more concise while preserving meaning. Output only the shortened text.",
  },
  {
    id: "expand",
    label: "Expand",
    mode: "replace",
    systemPrompt:
      "Expand the following text with more detail and explanation. Output only the expanded text.",
  },
  {
    id: "translate",
    label: "Translate",
    mode: "replace",
    systemPrompt:
      "Translate the following text to {language}. Output only the translation.",
  },
  {
    id: "tone",
    label: "Tone Change",
    mode: "replace",
    systemPrompt:
      "Rewrite the following text in a {tone} tone. Output only the rewritten text.",
  },
  {
    id: "explain",
    label: "Explain",
    mode: "generate",
    systemPrompt:
      "Explain the following text in simple terms. Output only the explanation.",
  },
];

const CODE_ACTIONS: AIAction[] = [
  {
    id: "add-comments",
    label: "Add Comments",
    mode: "replace",
    systemPrompt:
      "Add clear, concise comments to the following code. Output only the commented code.",
  },
  {
    id: "optimize",
    label: "Optimize",
    mode: "replace",
    systemPrompt:
      "Optimize the following code for performance and readability. Output only the optimized code.",
  },
  {
    id: "find-bugs",
    label: "Find Bugs",
    mode: "generate",
    systemPrompt:
      "Analyze the following code for potential bugs and issues. List each bug with explanation.",
  },
  {
    id: "convert-lang",
    label: "Convert",
    mode: "generate",
    systemPrompt:
      "Convert the following code to {language}. Output only the converted code.",
  },
  {
    id: "gen-tests",
    label: "Generate Tests",
    mode: "generate",
    systemPrompt:
      "Generate unit tests for the following code. Output only the test code.",
  },
];

const MATH_ACTIONS: AIAction[] = [
  {
    id: "solve-steps",
    label: "Show Steps",
    mode: "generate",
    systemPrompt:
      "Show step-by-step solution for the following LaTeX expression.",
  },
  {
    id: "fix-latex",
    label: "Fix LaTeX",
    mode: "replace",
    systemPrompt:
      "Fix any LaTeX syntax errors in the following expression. Output only corrected LaTeX.",
  },
  {
    id: "explain-math",
    label: "Explain",
    mode: "generate",
    systemPrompt:
      "Explain the following mathematical expression in plain language.",
  },
  {
    id: "related-formulas",
    label: "Related Formulas",
    mode: "generate",
    systemPrompt:
      "List related formulas and identities for the following expression.",
  },
];

const TABLE_ACTIONS: AIAction[] = [
  {
    id: "analyze-data",
    label: "Analyze Data",
    mode: "generate",
    systemPrompt:
      "Analyze the following markdown table data and provide insights.",
  },
  {
    id: "fill-cells",
    label: "Fill Cells",
    mode: "generate",
    systemPrompt:
      "Fill in empty cells in the following table based on patterns in existing data.",
  },
  {
    id: "suggest-rows",
    label: "Suggest Rows",
    mode: "generate",
    systemPrompt: "Suggest additional rows or columns for the following table.",
  },
  {
    id: "to-csv",
    label: "To CSV",
    mode: "generate",
    systemPrompt: "Convert the following markdown table to CSV format.",
  },
];

const STRUCTURE_ACTIONS: AIAction[] = [
  {
    id: "gen-toc",
    label: "Generate TOC",
    mode: "generate",
    systemPrompt:
      "Generate a table of contents for the following document structure.",
  },
  {
    id: "improve-structure",
    label: "Improve Structure",
    mode: "generate",
    systemPrompt: "Suggest improvements to the document structure.",
  },
  {
    id: "split-sections",
    label: "Split Sections",
    mode: "generate",
    systemPrompt: "Suggest how to split this content into separate sections.",
  },
  {
    id: "summarize",
    label: "Summarize",
    mode: "generate",
    systemPrompt: "Summarize the following document section.",
  },
];

const DIAGRAM_ACTIONS: AIAction[] = [
  {
    id: "improve-diagram",
    label: "Improve Diagram",
    mode: "replace",
    systemPrompt:
      "Improve the following Mermaid diagram for clarity and readability. Output only the improved Mermaid code.",
  },
  {
    id: "explain-diagram",
    label: "Explain",
    mode: "generate",
    systemPrompt:
      "Explain the following Mermaid diagram in plain language. Describe the flow, entities, and relationships.",
  },
  {
    id: "add-nodes",
    label: "Suggest Nodes",
    mode: "replace",
    systemPrompt:
      "Suggest additional nodes or connections for the following Mermaid diagram. Output only the improved Mermaid code.",
  },
  {
    id: "change-style",
    label: "Change Style",
    mode: "replace",
    systemPrompt:
      "Add styling (colors, shapes, line styles) to the following Mermaid diagram. Output only the styled Mermaid code.",
  },
  {
    id: "convert-diagram",
    label: "Convert Type",
    mode: "replace",
    systemPrompt:
      "Convert the following Mermaid diagram to a {diagramType} diagram type. Output only the converted Mermaid code.",
  },
];

const IMAGE_ACTIONS: AIAction[] = [
  {
    id: "gen-alt",
    label: "Generate Alt Text",
    mode: "generate",
    systemPrompt:
      "Generate a concise, descriptive alt text for an image with this context. Output only the alt text.",
  },
  {
    id: "gen-caption",
    label: "Generate Caption",
    mode: "generate",
    systemPrompt:
      "Write a descriptive caption for an image with this context. Output only the caption.",
  },
  {
    id: "describe-image",
    label: "Describe",
    mode: "generate",
    systemPrompt:
      "Describe the content and context of this image based on available metadata. Provide a detailed description.",
  },
];

const MODE_ACTIONS: Record<ContentMode, AIAction[]> = {
  code: CODE_ACTIONS,
  diagram: DIAGRAM_ACTIONS,
  image: IMAGE_ACTIONS,
  math: MATH_ACTIONS,
  structure: STRUCTURE_ACTIONS,
  table: TABLE_ACTIONS,
  text: TEXT_ACTIONS,
};

export function getActionsForMode(mode: ContentMode): AIAction[] {
  return MODE_ACTIONS[mode];
}
