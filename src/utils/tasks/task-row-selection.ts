// §312 아젠다 행에서 우클릭이 남긴 선택을 걷어낸다.
//
// ‼️ `user-select: none`으로는 막히지 않는다 — `.task-row`가 그것을 이미 걸고 있는데도
// 증상이 남았다(사용자 스크린샷: 메뉴가 열린 채 행의 한 낱말이 파랗게 칠해져 있다).
// WebKit은 컨텍스트 메뉴를 열 때 커서 밑 **낱말을 선택**하고, 그 동작은 선택 가능
// 여부와 별개로 일어난다. `contextmenu`가 도착했을 때 선택은 이미 만들어져 있으므로
// 막을 수 있는 것이 아니라 **되돌릴** 수 있을 뿐이다.

/**
 * `root` 안에 걸린 선택만 지운다. 밖의 선택은 그대로 둔다.
 *
 * ‼️ 범위가 닫혀 있는 것이 요점이다. 무조건 `removeAllRanges()`를 부르면 사용자가
 * 에디터에 잡아 둔 선택까지 날아가는데, 그것은 ProseMirror 선택이라 캐럿이 함께 튄다 —
 * 아젠다에서 우클릭 한 번에 편집 중이던 자리를 잃는다.
 */
export function dropSelectionInside(root: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  if (!root.contains(selection.anchorNode)) return;
  selection.removeAllRanges();
}
