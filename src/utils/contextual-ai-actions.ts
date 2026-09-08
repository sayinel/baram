// §11.2.3 Contextual AI Toolbar — mode-specific AI action definitions
import type { ContentMode } from "./content-type-detector";

export interface AIAction {
  id: string;
  label: string;
  /**
   * 'replace' → diff preview & replace block content; 'generate' → insert after block;
   * 'tasks' → §314 extraction, which runs its own flow and lands in the diff preview.
   *
   * ‼️ 'tasks' exists as its own mode because the other two stream straight into the
   * document. §18.20 risk 8 forbids that for extracted tasks: a task line is not confined
   * to the document — the moment it lands it shows up in the agenda, in query blocks and
   * in the tag index, so anything unreviewed spreads across the app. Folding extraction
   * into 'generate' would be exactly the bypass that note rules out.
   */
  mode: "generate" | "replace" | "tasks";
  systemPrompt: string;
}

/**
 * §314 액션 아이템 추출. `systemPrompt`가 비어 있는 것은 이 모드만 자기 프롬프트를
 * 밖에 두기 때문이다 — `extractActionItems`가 `ACTION_ITEM_SYSTEM_PROMPT`를 들고 있고,
 * 여기 한 벌 더 적으면 둘이 갈린다.
 */
export const EXTRACT_TASKS_ACTION: AIAction = {
  id: "extract-tasks",
  label: "ai.action.extractTasks",
  mode: "tasks",
  systemPrompt: "",
};

const TEXT_ACTIONS: AIAction[] = [
  {
    id: "improve",
    label: "ai.action.improve",
    mode: "replace",
    systemPrompt:
      "Improve the following text for clarity, grammar, and flow. Output only the improved text.",
  },
  {
    id: "shorten",
    label: "ai.action.shorten",
    mode: "replace",
    systemPrompt:
      "Make the following text more concise while preserving meaning. Output only the shortened text.",
  },
  {
    id: "expand",
    label: "ai.action.expand",
    mode: "replace",
    systemPrompt:
      "Expand the following text with more detail and explanation. Output only the expanded text.",
  },
  {
    id: "translate",
    label: "ai.action.translate",
    mode: "replace",
    systemPrompt:
      "Translate the following text to {language}. Output only the translation.",
  },
  {
    id: "tone",
    label: "ai.action.tone",
    mode: "replace",
    systemPrompt:
      "Rewrite the following text in a {tone} tone. Output only the rewritten text.",
  },
  {
    id: "explain",
    label: "ai.action.explain",
    mode: "generate",
    systemPrompt:
      "Explain the following text in simple terms. Output only the explanation.",
  },
];

const CODE_ACTIONS: AIAction[] = [
  {
    id: "add-comments",
    label: "ai.action.addComments",
    mode: "replace",
    systemPrompt:
      "Add clear, concise comments to the following code. Output only the commented code.",
  },
  {
    id: "optimize",
    label: "ai.action.optimize",
    mode: "replace",
    systemPrompt:
      "Optimize the following code for performance and readability. Output only the optimized code.",
  },
  {
    id: "find-bugs",
    label: "ai.action.findBugs",
    mode: "generate",
    systemPrompt:
      "Analyze the following code for potential bugs and issues. List each bug with explanation.",
  },
  {
    id: "convert-lang",
    label: "ai.action.convert",
    mode: "generate",
    systemPrompt:
      "Convert the following code to {language}. Output only the converted code.",
  },
  {
    id: "gen-tests",
    label: "ai.action.genTests",
    mode: "generate",
    systemPrompt:
      "Generate unit tests for the following code. Output only the test code.",
  },
];

const MATH_ACTIONS: AIAction[] = [
  {
    id: "solve-steps",
    label: "ai.action.solveSteps",
    mode: "generate",
    systemPrompt:
      "Show step-by-step solution for the following LaTeX expression.",
  },
  {
    id: "fix-latex",
    label: "ai.action.fixLatex",
    mode: "replace",
    systemPrompt:
      "Fix any LaTeX syntax errors in the following expression. Output only corrected LaTeX.",
  },
  {
    id: "explain-math",
    label: "ai.action.explain",
    mode: "generate",
    systemPrompt:
      "Explain the following mathematical expression in plain language.",
  },
  {
    id: "related-formulas",
    label: "ai.action.relatedFormulas",
    mode: "generate",
    systemPrompt:
      "List related formulas and identities for the following expression.",
  },
];

const TABLE_ACTIONS: AIAction[] = [
  {
    id: "analyze-data",
    label: "ai.action.analyzeData",
    mode: "generate",
    systemPrompt:
      "Analyze the following markdown table data and provide insights.",
  },
  {
    id: "fill-cells",
    label: "ai.action.fillCells",
    mode: "generate",
    systemPrompt:
      "Fill in empty cells in the following table based on patterns in existing data.",
  },
  {
    id: "suggest-rows",
    label: "ai.action.suggestRows",
    mode: "generate",
    systemPrompt: "Suggest additional rows or columns for the following table.",
  },
  {
    id: "to-csv",
    label: "ai.action.toCsv",
    mode: "generate",
    systemPrompt: "Convert the following markdown table to CSV format.",
  },
];

const STRUCTURE_ACTIONS: AIAction[] = [
  {
    id: "gen-toc",
    label: "ai.action.genToc",
    mode: "generate",
    systemPrompt:
      "Generate a table of contents for the following document structure.",
  },
  {
    id: "improve-structure",
    label: "ai.action.improveStructure",
    mode: "generate",
    systemPrompt: "Suggest improvements to the document structure.",
  },
  {
    id: "split-sections",
    label: "ai.action.splitSections",
    mode: "generate",
    systemPrompt: "Suggest how to split this content into separate sections.",
  },
  {
    id: "summarize",
    label: "ai.action.summarize",
    mode: "generate",
    systemPrompt: "Summarize the following document section.",
  },
];

const DIAGRAM_ACTIONS: AIAction[] = [
  {
    id: "improve-diagram",
    label: "ai.action.improveDiagram",
    mode: "replace",
    systemPrompt:
      "Improve the following Mermaid diagram for clarity and readability. Output only the improved Mermaid code.",
  },
  {
    id: "explain-diagram",
    label: "ai.action.explain",
    mode: "generate",
    systemPrompt:
      "Explain the following Mermaid diagram in plain language. Describe the flow, entities, and relationships.",
  },
  {
    id: "add-nodes",
    label: "ai.action.addNodes",
    mode: "replace",
    systemPrompt:
      "Suggest additional nodes or connections for the following Mermaid diagram. Output only the improved Mermaid code.",
  },
  {
    id: "change-style",
    label: "ai.action.changeStyle",
    mode: "replace",
    systemPrompt:
      "Add styling (colors, shapes, line styles) to the following Mermaid diagram. Output only the styled Mermaid code.",
  },
  {
    id: "convert-diagram",
    label: "ai.action.convertDiagram",
    mode: "replace",
    systemPrompt:
      "Convert the following Mermaid diagram to a {diagramType} diagram type. Output only the converted Mermaid code.",
  },
];

const SVG_ACTIONS: AIAction[] = [
  {
    id: "improve-svg",
    label: "ai.action.improveSvg",
    mode: "replace",
    systemPrompt:
      "Improve the following SVG markup for visual clarity and correctness while preserving its intent. Output only the raw SVG markup, no explanation, no code fences.",
  },
  {
    id: "explain-svg",
    label: "ai.action.explain",
    mode: "generate",
    systemPrompt:
      "Explain what the following SVG markup renders in plain language. Describe the shapes, colors, and layout.",
  },
  {
    id: "modify-svg",
    label: "ai.action.modifySvg",
    mode: "replace",
    systemPrompt:
      "Apply the requested change to the following SVG markup. Output only the raw SVG markup, no explanation, no code fences.",
  },
  {
    id: "change-style",
    label: "ai.action.changeStyle",
    mode: "replace",
    systemPrompt:
      "Restyle the following SVG markup (colors, strokes, fills) for a cleaner look while keeping the same shapes. Output only the raw SVG markup, no explanation, no code fences.",
  },
];

const IMAGE_ACTIONS: AIAction[] = [
  {
    id: "gen-alt",
    label: "ai.action.genAlt",
    mode: "generate",
    systemPrompt:
      "Generate a concise, descriptive alt text for an image with this context. Output only the alt text.",
  },
  {
    id: "gen-caption",
    label: "ai.action.genCaption",
    mode: "generate",
    systemPrompt:
      "Write a descriptive caption for an image with this context. Output only the caption.",
  },
  {
    id: "describe-image",
    label: "ai.action.describeImage",
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
  svg: SVG_ACTIONS,
  table: TABLE_ACTIONS,
  text: TEXT_ACTIONS,
};

/**
 * Every i18n key an action can carry, across every mode.
 *
 * Derived from MODE_ACTIONS rather than listed: `label-key-coverage.test.ts` checks these
 * resolve in both catalogues, and an enumeration there would go stale the moment a mode gains
 * an action — the defect class `settings.activitybar.item.tasks` shipped with.
 */
export const AI_ACTION_LABEL_KEYS: readonly string[] = [
  ...new Set(
    [...Object.values(MODE_ACTIONS).flat(), EXTRACT_TASKS_ACTION].map(
      (a) => a.label,
    ),
  ),
];

/**
 * §314 추출을 붙이는 모드. 회의록·논의 메모는 산문이므로 산문 모드에만 둔다 — 수식이나
 * 이미지를 고르고 "할 일 뽑기"를 권하는 것은 그 자리에서 뜻이 없는 항목이다.
 */
const EXTRACTABLE: ContentMode[] = ["structure", "text"];

export function getActionsForMode(mode: ContentMode): AIAction[] {
  const actions = MODE_ACTIONS[mode];
  return EXTRACTABLE.includes(mode)
    ? [...actions, EXTRACT_TASKS_ACTION]
    : actions;
}
