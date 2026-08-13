// §274 UX fix round 3 (defect B) — buildHighlightPath 고정. 실제 렌더
// 결과(겹치는 영역이 실제로 한 번만 칠해지는지)는 jsdom에 레이아웃이 없어
// 여기서 단정할 수 없다 — 시각 확인은 GUI-VERIFICATION.md로 넘긴다. 여기서는
// (1) 각 rect가 같은 감김 방향의 닫힌 서브패스가 되는지, (2) 겹치는 rect가
// 여러 번이 아니라 그대로 각 1개의 서브패스로만 나오는지(= 좌표가 사라지지
// 않는지, nonzero union이 동작하려면 subpath 자체는 안 지워야 한다), (3)
// 폭/높이 0인 rect는 건너뛰는지를 고정한다.
import { describe, expect, it } from "vitest";

import { buildHighlightPath } from "../pdf-highlight-path";

describe("buildHighlightPath", () => {
  it("rect 하나 — 시계 방향(오른쪽→아래→왼쪽)의 닫힌 서브패스 하나를 만든다", () => {
    const d = buildHighlightPath([{ height: 10, left: 5, top: 20, width: 30 }]);
    expect(d).toBe("M5 20 h30 v10 h-30 Z");
  });

  it("겹치는 두 rect(인접 줄) — 서브패스를 지우거나 합치지 않고 둘 다 그대로 이어 붙인다", () => {
    // 세로로 겹치는 두 "줄" — round 2 mergeRectsByLine의 반증 픽스처와 같은
    // 모양(위 줄의 아래쪽과 아래 줄의 위쪽이 겹친다).
    const lineA = { height: 14, left: 0, top: 0, width: 200 };
    const lineB = { height: 14, left: 0, top: 10, width: 200 }; // top 10~24가 lineA의 0~14와 겹침

    const d = buildHighlightPath([lineA, lineB]);

    expect(d).toBe("M0 0 h200 v14 h-200 Z M0 10 h200 v14 h-200 Z");
    // 두 서브패스 모두 남아 있어야 nonzero fill-rule이 겹친 구간을 감김수
    // 2로 보고도 "안쪽"으로 판정해 한 번만 칠한다 — 하나로 뭉개서 겹침
    // 영역의 좌표 정보 자체를 지워버리면 안 된다.
    expect(d.match(/M/g)).toHaveLength(2);
  });

  it("폭 또는 높이가 0인 rect는 건너뛴다", () => {
    const d = buildHighlightPath([
      { height: 10, left: 0, top: 0, width: 0 },
      { height: 0, left: 0, top: 0, width: 10 },
      { height: 10, left: 1, top: 2, width: 3 },
    ]);
    expect(d).toBe("M1 2 h3 v10 h-3 Z");
  });

  it("빈 배열 — 빈 문자열(그릴 것 없음)", () => {
    expect(buildHighlightPath([])).toBe("");
  });
});
