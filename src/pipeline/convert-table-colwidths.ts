// convert-table-colwidths.ts — §5.5 표 colwidths HTML 주석 → PM 테이블 셀 반영
//
// md-to-pm.ts에서 분리 — `<!-- colwidths:200,300,150 -->` 패턴을 인식하고, 그
// 값을 뒤따르는 테이블 노드의 셀에 colwidth/userResized로 적용하는 로직.
import type { Node as PmNode } from "@tiptap/pm/model";

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
