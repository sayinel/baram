// §313/§5.1 마크다운 줄 번호 → PM 위치.
//
// 오프셋 매퍼(`cursor-mapper.ts`)와 갈라져 있는 이유: 저쪽은 "이 글자가 어느 자리인가"를
// 묻고 이쪽은 "이 **줄**이 어느 자리인가"를 묻는다. 줄은 블록보다 잘다 — 목록 하나는 여러
// 줄이고, 코드 펜스 하나도 여러 줄이다 — 그래서 이쪽만이 컨테이너 안으로 내려간다.
import type { Node as PMNode } from "@tiptap/pm/model";

import {
  advancePastBlock,
  blockMatchText,
  textPosToPmOffset,
} from "./cursor-match";

/**
 * 마크다운 줄 번호(1-based) → 그 줄이 만든 내용의 PM 위치.
 *
 * ‼️ 계약은 "그 줄을 품은 **최상위** 블록의 시작"이 아니라 "그 줄 자체"다. 목록·인용문·
 * 표·코드 펜스는 여러 줄이면서 최상위 노드는 하나라, 블록 시작으로는 "이 목록의 세 번째
 * 항목"을 표현할 수 없다 — 항목 세 개가 전부 첫 항목으로 접혔다. 그래서 컨테이너 안으로
 * **내려간다**: 최상위에서 시작해 각 자식의 마크다운 구간을 재고, 목표 줄을 품은 자식으로
 * 한 단계씩 들어가 잎 텍스트블록에 닿으면 그 안에서의 문자 위치까지 짚는다.
 *
 * 표만은 행에서 멈춘다. 마크다운의 한 줄은 셀이 아니라 **행** 하나이므로, 셀까지 내려가는
 * 것은 없는 정보를 지어내는 일이다.
 */
export function mdLineToPmPos(
  doc: PMNode,
  content: string,
  line: number,
): number {
  if (doc.childCount === 0) return 0;

  const lines = content.split("\n");

  // Character offset of the start of the target line
  let targetOffset = 0;
  for (let i = 0; i < Math.min(Math.max(line - 1, 0), lines.length); i++) {
    targetOffset += lines[i].length + 1;
  }

  return descendToOffset(
    doc,
    0,
    content,
    0,
    content.length,
    targetOffset,
    false,
  );
}

/**
 * 노드가 차지하는 마크다운 구간의 끝.
 *
 * ‼️ 글자 맞추기만으로는 부족하다. 그것은 노드의 **PM 텍스트**가 끝난 자리를 줄 뿐이라,
 * 텍스트보다 마크다운이 긴 노드 — 내용이 전부 인라인 atom인 항목(`- [ ] #work`), 위키링크만
 * 든 항목 — 은 구간이 첫 줄에서 끝나고 나머지 줄이 **다음 형제**로 새어 나간다. 사용자가
 * 본 "세 번째 항목을 눌렀더니 목록 아래 문단으로 갔다"가 정확히 이것이다.
 *
 * 그래서 바닥을 깐다: 노드가 가진 "줄을 차지하는 잎"의 수만큼은 내용 줄을 반드시 먹는다.
 */
function advanceRegion(
  markdown: string,
  start: number,
  node: PMNode,
  inTable: boolean,
): number {
  // 표 안에서는 셀 경계가 줄바꿈이 아니다 — 구분자를 넣으면 행 텍스트가 마크다운에
  // 없는 "\n"을 찾아 문서 끝까지 달린다.
  const sep = inTable || node.type.name === "table" ? "" : "\n";
  const matched = advancePastBlock(markdown, start, blockMatchText(node, sep));
  return Math.max(matched, nthLineEnd(markdown, start, lineOwningLeaves(node)));
}

/**
 * `parent`의 자식들을 마크다운 구간과 나란히 걸으며 `target`을 품은 자식으로 내려간다.
 *
 * `parentContentStart`는 `parent`의 **내용 시작** PM 위치이고, `[regionStart, regionEnd]`는
 * 그 내용이 차지하는 마크다운 구간이다. 마지막 자식은 남은 구간을 전부 가져간다 —
 * 구간 계산이 조금 짧게 끝났을 때 목표가 아무 자식에도 속하지 않는 일을 막는다.
 */
function descendToOffset(
  parent: PMNode,
  parentContentStart: number,
  markdown: string,
  regionStart: number,
  regionEnd: number,
  target: number,
  inTable: boolean,
): number {
  let childPos = parentContentStart;
  let cursor = regionStart;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const isLast = i === parent.childCount - 1;
    const childEnd = isLast
      ? regionEnd
      : Math.min(advanceRegion(markdown, cursor, child, inTable), regionEnd);

    if (target <= childEnd || isLast) {
      const contentStart = childPos + (child.isLeaf ? 0 : 1);
      if (child.isTextblock) {
        return offsetWithinTextblock(
          child,
          contentStart,
          markdown,
          cursor,
          target,
        );
      }
      // 표는 행에서 멈춘다 — 줄 하나가 행 하나이지 셀 하나가 아니다.
      if (child.isLeaf || child.type.name === "tableRow") return contentStart;
      return descendToOffset(
        child,
        contentStart,
        markdown,
        cursor,
        childEnd,
        target,
        inTable || child.type.name === "table",
      );
    }

    cursor = childEnd;
    childPos += child.nodeSize;
  }

  return parentContentStart;
}

/** 이 노드가 반드시 차지하는 마크다운 **내용 줄**의 수(하한). */
function lineOwningLeaves(node: PMNode): number {
  // 표 = 행들 + 구분자 줄 하나. 셀까지 세면 한 줄에 여러 개가 앉아 과대 계산된다.
  if (node.type.name === "table") return node.childCount + 1;
  if (node.type.name === "tableRow") return 1;
  if (node.isTextblock) return node.content.size > 0 ? 1 : 0;
  if (node.isLeaf) return 1;
  let count = 0;
  node.forEach((child) => {
    count += lineOwningLeaves(child);
  });
  return count;
}

/**
 * `start`에서 시작해 빈 줄을 건너뛰고 내용 줄 `count`개를 지난 지점(그 마지막 줄의 끝).
 *
 * `start`가 줄 중간일 걱정은 하지 않는다. 앞 형제의 구간 끝도 같은 바닥을 지나 왔고
 * (줄을 가진 노드는 자기 마지막 줄 끝까지 먹는다), 줄을 하나도 갖지 않는 노드는 커서를
 * 움직이지 않는다 — 그래서 `start`는 늘 줄 경계이거나 그 줄의 "\n" 위다.
 */
function nthLineEnd(markdown: string, start: number, count: number): number {
  if (count <= 0) return start;

  let i = start;
  let seen = 0;
  let end = start;
  while (i <= markdown.length && seen < count) {
    let lineEnd = i;
    while (lineEnd < markdown.length && markdown[lineEnd] !== "\n") lineEnd++;
    if (markdown.slice(i, lineEnd).trim().length > 0) {
      seen++;
      end = lineEnd;
    }
    if (lineEnd >= markdown.length) break;
    i = lineEnd + 1;
  }

  return Math.max(end, start);
}

/**
 * 잎 텍스트블록 안에서의 위치. 블록 구간의 시작부터 목표까지 마크다운을 걸으며 이 블록의
 * 텍스트와 맞은 글자 수를 세고, 그 텍스트 위치를 PM 오프셋으로 되돌린다. 코드 펜스나
 * 소프트 줄바꿈이 든 문단처럼 **한 텍스트블록이 여러 줄**인 경우에 그 줄로 내려 준다.
 */
function offsetWithinTextblock(
  block: PMNode,
  contentStart: number,
  markdown: string,
  regionStart: number,
  target: number,
): number {
  const text = blockMatchText(block, "\n");
  if (text.length === 0) return contentStart;

  let pmCount = 0;
  for (let i = regionStart; i < target && i < markdown.length; i++) {
    if (pmCount < text.length && markdown[i] === text[pmCount]) pmCount++;
  }
  if (pmCount === 0) return contentStart;

  const offset = textPosToPmOffset(block, pmCount, false, true);
  return Math.min(contentStart + offset, contentStart + block.content.size);
}
