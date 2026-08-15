// §280 래스터 배율을 표시 배율에서 분리한다.
//
// 왜 필요한가 — 측정된 증상:
//
//   canvas.width = Math.floor(viewport.width * dpr);   // ‼️ 이 대입이 캔버스를 지운다
//   canvas.height = Math.floor(viewport.height * dpr);
//   const renderTask = page.render({ ... });           // 다음 줌 이벤트가 취소한다
//
// 줌 이벤트마다 캔버스를 비우고 다시 그리기 시작하는데, 그리기가 끝나기 전에
// 다음 이벤트가 도착해 `renderTask.cancel()`이 걸린다. 그래서 핀치하는 동안
// 페이지가 **비어 보인다** — "줌이 느리다"의 큰 몫이 이것이다.
//
// 해법: 래스터 해상도만 제스처가 멎은 뒤에 올린다. 표시 크기(.pdf-page의
// width/height)는 즉시 따라가고, `.pdf-page canvas { width:100%; height:100% }`
// (styles/editor/pdf.css)가 **이미** 캔버스를 홀더 크기로 늘려 그리므로 그
// 사이에도 페이지는 계속 보인다 — 잠깐 덜 선명할 뿐이다. 새 CSS는 필요 없다.
//
// ‼️ 이것은 "타이머로 상태를 억제하는" 우회가 아니다. 화면에 보이는 값은 매
// 이벤트마다 즉시 정확하게 갱신된다. 지연되는 것은 **선명도를 올리는 재래스터**
// 하나뿐이고, 그것은 사용자가 배율을 정한 뒤에 해야 의미가 있는 작업이다.
// 상호작용 중에는 싼 근사, 멎으면 정확한 결과 — 표준적인 점진적 렌더링이다.
import { useEffect, useState } from "react";

/** 제스처가 멎었다고 볼 때까지의 정지 시간. */
const SETTLE_MS = 140;

/**
 * `scale`을 따라가되, 값이 흔들리는 동안에는 마지막으로 안정된 값을 유지한다.
 *
 * 첫 값은 기다리지 않는다 — PdfPreview의 `scale`은 컨테이너를 재기 전까지 0이라,
 * 여기서 지연시키면 문서를 열 때마다 첫 페이지가 SETTLE_MS만큼 늦게 그려진다.
 */
export function useSettledScale(scale: number, settleMs = SETTLE_MS): number {
  const [settled, setSettled] = useState(scale);

  useEffect(() => {
    if (settled === scale) return;
    // 아직 아무것도 래스터하지 않았다 — 지연 없이 곧바로 그린다.
    if (settled <= 0) {
      setSettled(scale);
      return;
    }
    const id = setTimeout(() => setSettled(scale), settleMs);
    return () => clearTimeout(id);
  }, [scale, settled, settleMs]);

  return settled;
}
