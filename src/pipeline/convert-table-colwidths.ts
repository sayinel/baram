// convert-table-colwidths.ts — §5.5 표 colwidths HTML 주석 → PM 테이블 셀 반영
//
// md-to-pm.ts에서 분리 — `<!-- colwidths:200,300,150 -->` 패턴을 인식하고, 그
// 값을 뒤따르는 테이블 노드의 셀에 colwidth/userResized로 적용하는 로직.
import type { Node as PmNode } from "@tiptap/pm/model";
import type { Content, Root } from "mdast";

import { markdownParser } from "./markdown-parser";

/** Regex for colwidths HTML comment: `<!-- colwidths:200,300,150 -->` */
export const COLWIDTHS_RE = /^<!--\s*colwidths:([\d,]+)\s*-->$/;

/** Apply pending colwidths to a table PM node by setting colwidth + userResized on cells */
export function applyColwidthsToTable(
  tableNode: PmNode,
  colwidths: number[],
): PmNode {
  const rows: PmNode[] = [];
  tableNode.forEach((row) => {
    const cells: PmNode[] = [];
    let colIdx = 0;
    row.forEach((cell) => {
      const colspan = (cell.attrs.colspan as number) || 1;
      const colwidthArr = colwidths.slice(colIdx, colIdx + colspan);
      colIdx += colspan;
      // Only apply if the sliced array has valid widths matching colspan
      if (colwidthArr.length === colspan && colwidthArr.every((w) => w > 0)) {
        cells.push(
          cell.type.create(
            { ...cell.attrs, colwidth: colwidthArr, userResized: true },
            cell.content,
            cell.marks,
          ),
        );
      } else {
        cells.push(cell);
      }
    });
    rows.push(row.type.create(row.attrs, cells, row.marks));
  });
  return tableNode.type.create(tableNode.attrs, rows, tableNode.marks);
}

/** What may sit before a comment on its line: quote markers and indentation. */
const PREFIX_RE = /^[>\s]*$/;

/** Block containers whose children `convertBlockChildren` also reads as block-level. */
const BLOCK_CONTAINERS = new Set([
  "blockquote",
  "footnoteDefinition",
  "list",
  "listItem",
  "root",
]);

/**
 * Collect the 0-based indexes of lines to delete: each block-level colwidths
 * comment whose line holds nothing else, plus the blank line after it when a
 * blank (or no) line precedes the comment.
 */
function collectWidthCommentLines(
  node: Content | Root,
  lines: string[],
  out: Set<number>,
): void {
  if (!("children" in node)) return;
  const siblings = node.children as Content[];
  for (const [at, child] of siblings.entries()) {
    if (child.type === "html") {
      const { position } = child;
      if (
        !position ||
        position.start.line !== position.end.line ||
        !COLWIDTHS_RE.test(child.value)
      ) {
        continue;
      }
      const index = position.start.line - 1;
      const prefix = lines[index].slice(0, position.start.column - 1);
      // Anything but quote markers / indentation before the comment (a list
      // marker, say) would be deleted with the line.
      if (!PREFIX_RE.test(prefix)) continue;
      // Blank means blank inside this container: whitespace only, or just the
      // comment's own quote markers. A bare `>` at root level is content.
      const own = prefix.trimEnd();
      const isBlank = (line: string) =>
        /^\s*$/.test(line) || line.trimEnd() === own;
      const prevBlank = index === 0 || isBlank(lines[index - 1]);
      const hasNext = index + 1 < lines.length;
      const nextBlank = hasNext && isBlank(lines[index + 1]);
      // A table on the very next line stays its own block without the comment
      // (the serializer writes a table in a list item this way).
      const next = siblings[at + 1];
      const tableFollows =
        next?.type === "table" &&
        next.position?.start.line === position.end.line + 1;
      // Dropping the comment must not glue the blocks around it together.
      if (!hasNext) {
        out.add(index);
      } else if (nextBlank) {
        out.add(index);
        if (prevBlank) out.add(index + 1);
      } else if (prevBlank || tableFollows) {
        out.add(index);
      }
    } else if (BLOCK_CONTAINERS.has(child.type)) {
      collectWidthCommentLines(child, lines, out);
    }
  }
}

/**
 * Remove block-level `<!-- colwidths:… -->` comments (and the blank line after
 * each) from markdown text. Found through the parser so code, inline html and
 * front matter are left alone. Returns the input unchanged if nothing matches.
 */
export function stripTableWidthComments(markdown: string): string {
  if (!markdown.includes("colwidths")) return markdown;
  // Split on all three line endings the parser recognises, keeping them so
  // the lines that stay are byte-for-byte unchanged.
  const parts = markdown.split(/(\r\n|\n|\r)/);
  const lines: string[] = [];
  const eols: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts[i]);
    eols.push(parts[i + 1] ?? "");
  }
  const doomed = new Set<number>();
  collectWidthCommentLines(
    markdownParser.parse(markdown) as Root,
    lines,
    doomed,
  );
  if (doomed.size === 0) return markdown;
  return lines.map((line, i) => (doomed.has(i) ? "" : line + eols[i])).join("");
}
