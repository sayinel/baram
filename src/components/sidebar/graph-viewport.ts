/** Cytoscape의 카메라 — 줌 배율과 팬 오프셋. */
export interface GraphViewport {
  pan: { x: number; y: number };
  zoom: number;
}

/** Cytoscape 컨테이너의 현재 상자. 요소가 없으면 null. */
export function boxOf(
  el: HTMLElement | null | undefined,
): null | { height: number; width: number } {
  return el ? { height: el.clientHeight, width: el.clientWidth } : null;
}

/**
 * 이 카메라를 기억할 가치가 있는가.
 *
 * ‼️ `zoom: 1, pan: (0,0)`은 cytoscape가 **손대지 않은 초기 뷰포트**이고, 컨테이너가 0×0이
 * 된 뒤 실측에서 나온 바로 그 값이다. 그걸 기억해 두면 깨진 화면을 고정해 버린다. 팬이라도
 * 움직였다면 줌이 1이어도 사용자가 실제로 놓은 자리이므로 받아들인다.
 */
export function isUsableViewport(vp: GraphViewport): boolean {
  if (!Number.isFinite(vp.zoom) || vp.zoom <= 0) return false;
  if (!Number.isFinite(vp.pan.x) || !Number.isFinite(vp.pan.y)) return false;
  return !(vp.zoom === 1 && vp.pan.x === 0 && vp.pan.y === 0);
}

// §286 그래프의 뷰포트 작업 가드.
//
// Cytoscape의 `resize()`와 `fit()`은 컨테이너를 재서 줌/팬을 정한다. `display: none` 아래에서
// 재면 0×0이 나오고 뷰포트가 degenerate해져 노드가 구석으로 뭉친다 — 실앱에서 그래프 ↔
// PDF/HTML 전환이 정확히 그랬다.
//
// 유지 집합(§286) 이전에는 이 상황이 없었다. 그래프 탭을 떠나면 언마운트됐기 때문이다. 이제는
// 마운트된 채로 숨으므로, `activeFilePath`에 의존하는 필터 effect가 **탭을 바꿀 때마다** 숨은
// 그래프 위에서 돈다.
//
// 타이밍 추정이 아니라 사실 판정이다: "잴 화면이 있는가".
export function shouldRunViewportWork(
  visible: boolean,
  box: null | { height: number; width: number },
): boolean {
  return visible && !!box && box.width > 0 && box.height > 0;
}
