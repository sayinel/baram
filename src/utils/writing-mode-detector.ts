// §11.3.1 WritingModeDetector — detect writing mode from document context
// Priority chain: frontmatter → path patterns → document structure → editing patterns → fallback

export interface DetectorInput {
  avgParagraphLength?: number;
  filePath: string;
  frontmatter: Record<string, unknown>;
  inlineMarkRatio?: number;
  nodeTypes: Record<string, number>;
}

export interface DetectorResult {
  confidence: number;
  mode: WritingMode;
}

export type WritingMode =
  | "academic"
  | "creative"
  | "general"
  | "journal"
  | "notes"
  | "skills"
  | "technical";

export function detectWritingMode(input: DetectorInput): DetectorResult {
  // Priority 1: Explicit frontmatter type
  if (input.frontmatter.type === "paper")
    return { confidence: 0.95, mode: "academic" };
  if (input.frontmatter.type === "journal")
    return { confidence: 0.95, mode: "journal" };

  // Priority 2: Path patterns
  if (/^skills\//.test(input.filePath) || /\.skill\.md$/.test(input.filePath)) {
    return { confidence: 0.9, mode: "skills" };
  }
  if (/^journal\//.test(input.filePath))
    return { confidence: 0.9, mode: "journal" };
  if (/^docs\//.test(input.filePath))
    return { confidence: 0.8, mode: "technical" };

  // Priority 3: Document structure
  const { nodeTypes } = input;
  const mathCount = (nodeTypes.mathBlock ?? 0) + (nodeTypes.mathInline ?? 0);
  if (mathCount >= 2) return { confidence: 0.8, mode: "academic" };

  const codeCount = nodeTypes.codeBlock ?? 0;
  if (codeCount >= 3) return { confidence: 0.7, mode: "technical" };

  const listItemCount = nodeTypes.listItem ?? 0;
  const wikiLinkCount = nodeTypes.wikiLink ?? 0;
  const totalNodes = Object.values(nodeTypes).reduce((s, n) => s + n, 0) || 1;
  if (listItemCount / totalNodes > 0.5 || wikiLinkCount >= 2) {
    return { confidence: 0.7, mode: "notes" };
  }

  // Priority 4: Editing patterns
  if (
    input.avgParagraphLength &&
    input.avgParagraphLength < 50 &&
    (input.inlineMarkRatio ?? 0) > 0.1
  ) {
    return { confidence: 0.6, mode: "creative" };
  }

  return { confidence: 0.5, mode: "general" };
}
