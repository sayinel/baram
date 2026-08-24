// §4.2 줌 레벨의 정규화 — 범위 제한과 정밀도를 **한 곳에서** 정한다.
//
// ‼️ 이 파일이 존재하는 이유가 곧 고쳐진 버그다. 전에는 같은 규칙이 두 곳에
// 각각 적혀 있었다 — `use-zoom.ts`의 clampZoom과 `editor-settings.ts`의
// setZoomLevel. 둘 다 `Math.round(level * 100) / 100`으로 **1%에 양자화**했고,
// 그래서 한쪽만 고치면 단위 테스트는 초록인데 실앱은 그대로 멈춰 있었다.
//
// 왜 1% 양자화가 버그였나: 양자화된 값이 곧 다음 이벤트의 누산기였다. 휠
// 이벤트마다 `zoomLevel - deltaY * 0.005`를 반올림해 되쓰므로, 1%에 못 미치는
// 변화량은 누적되지 못하고 매번 버려진다. 측정값(node, 수정 전 산술 그대로):
//
//   deltaY=-1 → 1 - (-1 * 0.005) = 1.005 → 1.005 * 100 = 100.49999999999999
//                                        → Math.round → 100 → 1.0  (제자리)
//   deltaY=+1 → 0.995 * 100 = 99.5       → Math.round → 100 → 1.0  (제자리)
//
//   |deltaY| <= 1 인 이벤트를 **500번** 연속으로 보내도 줌은 1.0에서 한 번도
//   움직이지 않는다. 부드러운 핀치에서 줌이 "느린" 것이 아니라 죽어 있었다.
//
// 그래서 정밀도를 4자리로 낮춘다(0.0001). 완전한 연속값으로 두지 않는 이유는
// 이 값이 설정 JSON에 영속화되기 때문이다 — 부동소수점 찌꺼기가 그대로 쌓여
// 파일에 남는 것을 막는다. 트랙패드가 내는 가장 작은 의미 있는 변화량조차
// (deltaY=0.5 → 0.0025) 이 격자에서 25칸이라 누적에 지장이 없다.

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.0;

/** 0.0001 격자. 위 주석의 "왜 1%가 아닌가"를 참조. */
const ZOOM_PRECISION = 10_000;

/**
 * 줌 레벨을 [MIN_ZOOM, MAX_ZOOM]으로 제한하고 저장 가능한 정밀도로 맞춘다.
 *
 * 유한하지 않은 입력은 1(기본 배율)로 떨어뜨린다 — 호출부가 `deltaY`처럼
 * 외부에서 온 값을 곱해 넘기므로 NaN/Infinity가 스토어에 들어가면 그 시점부터
 * 모든 배율 계산이 NaN이 되어 화면이 통째로 사라진다.
 */
export function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  const bounded = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
  return Math.round(bounded * ZOOM_PRECISION) / ZOOM_PRECISION;
}
