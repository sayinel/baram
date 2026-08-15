// §274 UX fix round 3 (defect B) — 같은 하이라이트에 속한 rect들을 하나의
// SVG <path>로 합쳐 그린다.
//
// 인접한 두 줄의 rect는 폰트 ascent/descent가 실제 글자보다 넉넉해 세로로
// 겹친다(mergeRectsByLine은 "같은 줄" 안에서만 합치므로 이 겹침은 남는다).
// 이전에는 PdfPage.tsx가 rect마다 반투명 배경(alpha ~0.35)의 <div>를 하나씩
// 겹쳐 그렸는데, 겹치는 구간은 그 반투명 배경이 두 번 칠해져(1-(1-0.35)^2 ≈
// 0.58) 눈에 띄게 진하게 보였다 — 사용자가 스크린샷으로 보고한 "이중으로
// 겹쳐 하이라이트가 된 것처럼 진해 보이는" 줄 경계선이 이것이다.
//
// 여러 <rect> 서브패스를 같은 감김 방향(시계 방향: 오른쪽→아래→왼쪽→위로
// 닫기)으로 한 <path>의 `d`에 이어 붙이면, SVG 기본 fill-rule인 nonzero가
// 겹친 영역도(감김수 2 이상이라도) "안쪽"으로 판정해 path 전체를 딱 한 번만
// 칠한다 — 겹치는 개수·정도와 무관하게 항상 균일한 불투명도가 나온다. 색은
// 그대로 두고(§273.3 요구대로 캔버스 위 글자가 계속 비쳐 보임 — 칠하는
// "횟수"만 바뀌었지 알파값 자체는 그대로다) 5색 구분성도 그대로다.
//
// (다른 후보였던 "격리된 스택 컨텍스트 + 그룹 opacity"는 기하 변화에 더
// 안전해 보이지만, 이 프로젝트에서는 §275.6 하이라이트 flash 링(같은
// <div>에 outline 애니메이션을 얹는 방식)까지 함께 흐려지는 부작용이 있고
// opaque 버전 토큰을 새로 만들어야 해서 기각했다 — 이 nonzero union 방식은
// flash 링을 완전히 건드리지 않고, 기존 반투명 토큰을 그대로 쓴다.)
export interface LocalRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

export function buildHighlightPath(rects: readonly LocalRect[]): string {
  return rects
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => `M${r.left} ${r.top} h${r.width} v${r.height} h${-r.width} Z`)
    .join(" ");
}
