// §313 "이 파일의 이 자리로 가라"는 요청 하나의 수명 — 만들기·소비하기·스크롤하기.
//
// 예전에는 요청이 `useLinkStore`의 값 세 개로만 있었고 주소가 없었다. 그래서 두 가지가
// 동시에 깨져 있었다:
//
// - **이미 활성인 탭에는 배달되지 않는다.** `openFileByPath`는 이미 열린 파일에 대해
//   `setActiveTab(같은 id)`로 단락되고(`open-file.ts:13-17`), `useTabSwitching`의 effect는
//   `[activeTabId]`에만 걸려 있어 다시 돌지 않는다. 소비자가 하나도 실행되지 않는다.
// - **소비되지 않은 요청이 남는다.** 지우는 곳이 소비자 자신뿐이라, 배달되지 못한 값은
//   그대로 남아 **다음** 탭 전환이 집어 간다 — 열지도 않은 파일의 줄 번호로 사용자가
//   방금 연 문서를 스크롤한다.
//
// 두 결함의 뿌리가 같으므로 고치는 방법도 하나다: 요청에 **주소**(파일 경로)를 붙이고,
// 착륙한 탭이 주소가 다른 요청을 만나면 적용하지 않고 **버린다**. 주소가 있으니 이미
// 활성인 탭도 자기 앞으로 온 요청을 알아볼 수 있다.
//
// 정책이 스토어가 아니라 여기 있는 이유: 판정에 `useEditorStore`가 필요한데(어느 탭이
// 활성인가) 링크 스토어를 에디터 스토어에 묶고 싶지 않다. 스토어는 기록만 들고, 규칙은
// 이 모듈이 유일하게 갖는다.
import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

import { useEditorStore } from "../../stores/editor/editor";
import { useLinkStore } from "../../stores/editor/link";
import { findBlockPosById, findHeadingPosByText } from "./block-nav";
import { mdLineToPmBlockStart } from "./cursor-mapper";
import { focusEditorView } from "./focus-editor-view";

/** 문서 안의 목적지. 한 요청에 정확히 하나. */
export type ScrollTarget =
  | { kind: "blockId"; value: string }
  | { kind: "heading"; value: string }
  /** 1-based — `mdLineToPmBlockStart`가 `line - 1`을 쓴다. */
  | { kind: "line"; value: number };

/**
 * `path`의 `target` 자리로 가 달라는 요청을 건다. 부른 쪽은 이어서 파일을 열면 된다
 * (이미 열려 있어도 상관없다 — 그 경우를 배달하는 것이 이 요청의 존재 이유다).
 */
export function requestScroll(path: string, target: ScrollTarget): void {
  useLinkStore.getState().setPendingScroll({
    blockId: target.kind === "blockId" ? target.value : null,
    heading: target.kind === "heading" ? target.value : null,
    line: target.kind === "line" ? target.value : null,
    originTabId: useEditorStore.getState().activeTabId,
    path,
  });
}

/**
 * 목적지를 좌표로 바꾸고 그리로 커서를 옮긴다.
 *
 * `content`는 그 파일의 마크다운 — 줄 번호 목적지에만 필요하므로 없으면 `null`을 준다.
 *
 * 실제 dispatch는 다음 프레임에 한다. 호출자들(탭 전환 직후·문서 로드 직후)이 전부
 * 상태가 아직 자리를 잡는 중인 시점이라, 지금 잡아 둔 좌표가 아니라 **그때의** 문서에서
 * 다시 해석해야 한다.
 */
export function scrollToTarget(
  view: EditorView,
  content: null | string,
  target: ScrollTarget,
): void {
  const pos = resolveScrollPos(view.state.doc, content, target);
  if (pos === null) return;
  requestAnimationFrame(() => {
    if (view.isDestroyed) return;
    try {
      const clamped = Math.min(Math.max(pos, 0), view.state.doc.content.size);
      const tr = view.state.tr
        .setSelection(TextSelection.near(view.state.doc.resolve(clamped)))
        .scrollIntoView();
      view.dispatch(tr);
      // 순수 selection 트랜잭션이라 Tiptap `update`가 뜨지 않는다 — 탭이 dirty로
      // 물들지 않는다.
      focusEditorView(view);
      // PM의 scrollIntoView는 뷰 안에서만 스크롤한다 — 바깥 `.editor-area-scroll`
      // 컨테이너까지 따라오게 하려면 DOM 쪽도 밀어 줘야 한다.
      const domInfo = view.domAtPos(clamped);
      const el =
        domInfo.node instanceof HTMLElement
          ? domInfo.node
          : domInfo.node.parentElement;
      el?.scrollIntoView({ block: "center" });
    } catch {
      // 좌표가 더는 유효하지 않다 — 그 사이 문서가 바뀐 것이므로 스크롤을 포기한다.
    }
  });
}

/**
 * **착륙한** 탭의 소비자. 탭 전환이 끝나 `path`의 문서가 화면에 올라온 시점에 부른다.
 *
 * 주소가 다른 요청은 돌려주지 않고 **버린다**: 여기까지 왔다는 것은 사용자가 다른
 * 파일에 도착했다는 뜻이고, 그 요청을 배달할 전환은 이제 오지 않는다. 남겨 두면 다음
 * 전환이 그것을 엉뚱한 문서에 적용한다.
 */
export function takePendingScroll(path: null | string): null | ScrollTarget {
  const state = useLinkStore.getState();
  const addressedTo = state.pendingScrollPath;
  if (addressedTo !== null && addressedTo !== path) {
    state.clearPendingScroll();
    return null;
  }
  const target = readTarget();
  // 주소도 목적지도 없으면 요청 자체가 없다 — 쓸데없이 스토어를 쓰지 않는다.
  if (addressedTo === null && target === null) return null;
  state.clearPendingScroll();
  return target;
}

/**
 * **이미 활성인** 탭의 소비자. 탭 전환이 일어나지 않아 위 소비자가 돌지 않는 경우다.
 *
 * 판정 기준이 "활성 탭의 경로가 주소와 같은가"만이 아닌 이유: 배경 탭으로의 전환은
 * 같은 React 커밋 안에서 `activeTabId`를 이미 바꿔 놓는다. 경로만 보면 여기서 통과하지만
 * 에디터는 아직 나가는 문서를 들고 있어, 그 문서를 스크롤하고 요청까지 삼킨다. 요청
 * **당시** 활성이던 탭이 지금도 활성이라는 것이 "전환은 없다"의 정확한 진술이다.
 */
export function takeSameTabScroll(): null | ScrollTarget {
  const state = useLinkStore.getState();
  if (state.pendingScrollPath === null) return null;
  const { activeTabId, tabs } = useEditorStore.getState();
  if (activeTabId !== state.pendingScrollOriginTabId) return null;
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab || tab.filePath !== state.pendingScrollPath) return null;
  const target = readTarget();
  // 대상이 비어 있어도 기록은 지운다 — 다른 소비자(§5.11 검색 하이라이트)가 목적지만
  // 먼저 가져간 경우이고, 주소만 남겨 두면 영원히 소비되지 않는 찌꺼기가 된다.
  state.clearPendingScroll();
  return target;
}

function readTarget(): null | ScrollTarget {
  const { pendingScrollBlockId, pendingScrollHeading, pendingScrollLine } =
    useLinkStore.getState();
  if (pendingScrollBlockId)
    return { kind: "blockId", value: pendingScrollBlockId };
  if (pendingScrollLine) return { kind: "line", value: pendingScrollLine };
  if (pendingScrollHeading)
    return { kind: "heading", value: pendingScrollHeading };
  return null;
}

function resolveScrollPos(
  doc: PmNode,
  content: null | string,
  target: ScrollTarget,
): null | number {
  switch (target.kind) {
    case "blockId":
      return findBlockPosById(doc, target.value);
    case "heading": {
      const pos = findHeadingPosByText(doc, target.value);
      return pos === null ? null : pos + 1;
    }
    case "line":
      return content === null
        ? null
        : mdLineToPmBlockStart(doc, content, target.value);
  }
}
