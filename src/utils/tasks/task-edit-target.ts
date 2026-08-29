// M2-b4 편집 모달의 대상 판정 — "커서가 있는 블록"을 찾는 유일한 규칙.
//
// 커서의 좌우 위치는 보지 않는다. 문장 중간이든 끝이든 결과가 같아야 한다: 다르게
// 동작하면 사용자가 키를 누르기 전에 커서를 어디 뒀는지 기억해야 하고, 그건 이 모달의
// 존재 이유(입력 규칙을 외우지 않아도 되게 한다)와 정면으로 어긋난다.
//
// 팔레트의 `Insert ▸ Task List`가 이미 같은 규칙이다 — `toggleTaskList()`는 커서가
// 문단 어디에 있든 그 문단을 통째로 태스크로 바꾼다.

import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

export interface TaskEditTarget {
  /** 태스크면 체크 상태 — 저장할 때 그대로 되돌려 준다(상태 전이는 이 모달의 일이 아니다) */
  checked: boolean;
  /** 이 블록이 이미 태스크인가 — 아니면 저장할 때 태스크로 바꾼다 */
  isTask: boolean;
  /** 갈아끼울 블록 노드 — `taskItem` 또는 문단 */
  node: PMNode;
  /** 그 노드 **앞**의 문서 좌표. 교체 범위는 `pos ~ pos + node.nodeSize` */
  pos: number;
}

/**
 * 변환이 말이 되지 않는 자리. 여기서는 키가 **아무 일도 하지 않는다.**
 *
 * 세 갈래다: 내용이 글자 그대로여야 하는 곳(코드·수식·다이어그램·HTML·프론트매터·
 * 쿼리), 태스크 리스트를 담을 수 없는 곳(GFM 표 셀은 인라인만 받는다), 그리고 바꿀
 * 수는 있지만 사용자가 의도했을 리 없는 곳(제목).
 *
 * ‼️ 이름은 `src/extensions/nodes/*`의 `name:`과 **글자 그대로** 같아야 한다. 틀린
 * 이름은 조용히 아무것도 막지 않는다 — 가드가 없는 것과 구별되지 않는다.
 * (표는 `table`이 아니라 `tableCell`/`tableHeader`가 커서를 감싼다.)
 *
 * 인용문·콜아웃·토글은 **일부러 뺐다.** `> - [ ] 할 일`은 정상 마크다운이고
 * 라운드트립도 된다.
 */
const REFUSED_ANCESTORS = new Set([
  "codeBlock",
  "frontmatter",
  "heading",
  "htmlBlock",
  "mathBlock",
  "mermaidBlock",
  "queryBlock",
  "svgBlock",
  "tableCell",
  "tableHeader",
]);

/**
 * 커서가 있는 블록을 편집 대상으로 돌려준다. 대상이 없으면 `null`.
 *
 * 선택 영역은 **보지 않는다.** 선택한 부분만 태스크로 만들면 나머지 문장이 갈 곳이
 * 없고, 블록을 쪼개는 것은 크기가 다른 작업이라 잘못하면 글자를 잃는다. 지금은 언제나
 * 블록 하나가 통째로 대상이다.
 */
export function resolveTaskEditTarget(
  editor: Editor | null,
): null | TaskEditTarget {
  if (!editor || !editor.isEditable) return null;

  const { $from } = editor.state.selection;

  for (let depth = $from.depth; depth > 0; depth--) {
    if (REFUSED_ANCESTORS.has($from.node(depth).type.name)) return null;
  }

  if (!$from.parent.isTextblock) return null;

  // 태스크 항목이면 그 **항목 전체**가 대상이다(안의 문단이 아니라). 체크 상태를 항목이
  // 들고 있고, 마크다운으로 오갈 때 `- [ ] `를 만드는 것도 항목이기 때문이다.
  const taskDepth = findTaskItemDepth($from);
  if (taskDepth !== null) {
    const node = $from.node(taskDepth);
    return {
      checked: node.attrs.checked === true,
      isTask: true,
      node,
      pos: $from.before(taskDepth),
    };
  }

  return {
    checked: false,
    isTask: false,
    node: $from.parent,
    pos: $from.before($from.depth),
  };
}

/** 커서를 감싼 `taskItem`의 깊이 — 없으면 `null`. */
function findTaskItemDepth($from: ResolvedPos): null | number {
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "taskItem") return depth;
  }
  return null;
}
