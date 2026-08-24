// §288 규칙 4 — 편집 영역의 "지금 보이는" 스크롤 컨테이너.
//
// 유지 집합(§286)이 도입되면서 `.editor-area-scroll`이 DOM에 여러 개 존재한다(숨은 것 포함).
// 순진한 document.querySelector는 문서 순서상 첫 번째를 돌려주므로 숨은 표면을 집을 수 있다.
// table-insert-coords.ts가 이미 쓰던 [data-editor-active] 우선 규칙을 여기로 모았다.
export function activeEditorScrollContainer(
  root: Document | HTMLElement = document,
): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(
      ".editor-area-scroll[data-editor-active]",
    ) ?? root.querySelector<HTMLElement>(".editor-area-scroll")
  );
}
