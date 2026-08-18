// §288 규칙 5 — 레이아웃에서 빠진 동안의 측정은 무의미하다.
//
// §286 유지 집합은 보이지 않는 PDF 표면을 `display: none`으로 숨긴다. 그러면 ResizeObserver가
// 0을 실어 보내는데, 그 0이 containerWidth로 들어가면 availableFitWidth가 음수가 되고
// baseScale이 0으로 남아 `pagesReady`가 false가 된다 — 페이지·툴바·레일이 **전부** 사라지고
// 레일 토글조차 없어 앱 안에서는 되돌릴 수 없다. §283에서 저장된 레일 폭 때문에 실측 avail
// = −136으로 똑같은 실패를 이미 한 번 겪었다.
//
// 타이밍 추정이 아니다: "요소가 레이아웃에 없다"는 사실 판정이고, 그때의 폭은 창의 폭에 대해
// 아무것도 말해 주지 않으므로 마지막으로 알던 값을 유지하는 것이 옳다.
export function nextContainerWidth(measured: number, current: number): number {
  return measured > 0 ? measured : current;
}
