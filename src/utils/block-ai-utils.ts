import type { ContentMode } from "./content-type-detector";
// §11.2.3 Block AI Utils — helpers for BlockHandle AI submenu
import type { Node as PmNode } from "@tiptap/pm/model";

/**
 * Determine the ContentMode for a single ProseMirror block node.
 */
export function getBlockContentMode(node: PmNode): ContentMode {
  const typeName = node.type.name;

  if (typeName === "codeBlock") return "code";
  if (typeName === "mathBlock" || typeName === "mathInline") return "math";
  if (typeName === "table") return "table";
  if (typeName === "heading") return "structure";

  return "text";
}

/**
 * Extract text content from a block node for use as AI prompt input.
 * Handles atom nodes that may store content in attrs rather than textContent.
 */
export function getBlockTextContent(node: PmNode): string {
  const typeName = node.type.name;

  // CodeBlock: content is in textContent
  if (typeName === "codeBlock") {
    const lang = (node.attrs.language as string) || "";
    const code = node.textContent || "";
    return lang ? `\`\`\`${lang}\n${code}\n\`\`\`` : code;
  }

  // MathBlock: LaTeX stored in textContent
  if (typeName === "mathBlock") {
    return node.textContent || "";
  }

  // Table: serialize to simple markdown-like representation
  if (typeName === "table") {
    return serializeTableNode(node);
  }

  // Default: textContent
  return node.textContent || "";
}

/**
 * Serialize a ProseMirror table node to a simple markdown table string.
 */
function serializeTableNode(tableNode: PmNode): string {
  const rows: string[][] = [];

  tableNode.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      cells.push(cell.textContent || "");
    });
    rows.push(cells);
  });

  if (rows.length === 0) return "";

  const lines: string[] = [];
  // Header row
  lines.push("| " + rows[0].join(" | ") + " |");
  // Separator
  lines.push("| " + rows[0].map(() => "---").join(" | ") + " |");
  // Body rows
  for (let i = 1; i < rows.length; i++) {
    lines.push("| " + rows[i].join(" | ") + " |");
  }

  return lines.join("\n");
}
