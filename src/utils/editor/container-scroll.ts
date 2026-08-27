// §313 점프 한 번이 스크롤해도 되는 것은 **에디터의 스크롤 컨테이너 하나**다.
//
// 앞선 구현은 목적지 DOM 노드에 `Element.scrollIntoView({ block: "center" })`를 걸었다.
// 그 API에는 "이 조상을 뜻했다"고 말할 방법이 없어 **스크롤 가능한 조상을 전부** 움직인다.
// 창이 넓을 때는 앱 셸에 여유가 없어 티가 나지 않지만, 창이 작아지면 셸 자체가 스크롤
// 가능해지고 `block: "center"`가 그 셸까지 가운데 맞춤 해서 탭 바들을 위로 밀어 잘라낸다
// (사용자 스크린샷: 파일 탭 바가 볼트 탭 바 뒤로 숨는다).
//
// 그래서 여기서는 조상을 **고르지 않는다**. 컨테이너를 이름으로 찾고(`[data-editor-scroll]`
// — 앱이 에디터 스크롤 표면에 직접 붙이는 표시), 그 하나의 `scrollTop`에만 쓴다. 못 찾으면
// 아무것도 스크롤하지 않는다: "전부 스크롤"보다 "하나도 안 함"이 나은 실패다.
//
// 좌표계: `coordsAtPos`와 `getBoundingClientRect`는 CSS zoom이 곱해진 **시각** 공간이고
// `scrollTop`/`clientHeight`/`scrollHeight`는 컨테이너 안쪽 **콘텐츠** 공간이다
// (src/utils/zoom-coords.ts). 시각 델타는 zoom으로 나눠 넘긴다 — vim 스크롤 어댑터가
// 기기에서 확인한 규칙과 같다(`extensions/plugins/vim/adapters/scroll.ts`).

import type { EditorView } from "@tiptap/pm/view";

import { revealBlockInActiveEditor } from "../../extensions/plugins/viewport-virtualize";
import { getEditorZoom } from "../zoom-coords";

/** 한 번의 계산에 필요한 전부 — 전부 컨테이너의 **콘텐츠** 공간 픽셀이다. */
export interface ContainerFrame {
  /** `container.scrollHeight`. */
  scrollHeight: number;
  /** `container.scrollTop` — 지금 위치. */
  scrollTop: number;
  /** 목적지의 높이. */
  targetHeight: number;
  /** 컨테이너의 보이는 위쪽 모서리 → 목적지 위쪽. 음수면 목적지가 위로 잘려 있다. */
  targetTop: number;
  /** `container.clientHeight` — 보이는 높이. */
  viewport: number;
}

/**
 * 점프의 착지 지점: 목적지 위쪽을 뷰포트 위에서 이만큼 **아래**에 놓는다.
 *
 * 가장자리 맞춤(PM의 기본)이 아니라 여백을 두는 이유는 점프가 읽기 행위이기 때문이다 —
 * 아래에서 올라온 목적지를 맨 아래 줄에 붙여 놓으면 뒤따르는 내용이 한 줄도 안 보인다.
 * 그리고 여백을 고정하면 착지 지점이 **어느 방향에서 왔는지와 무관하게** 같아진다.
 */
const LEAD_FRACTION = 1 / 3;

interface Coords {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

/** 재는 데 필요한 것만 — 테스트가 뷰 전체를 만들지 않아도 되게. */
type MeasurableView = Pick<EditorView, "coordsAtPos" | "dom">;

/**
 * 새 `scrollTop`, 또는 **움직이지 말라**는 뜻의 `null`.
 *
 * 이미 통째로 보이는 목적지는 건드리지 않는다: 화면 안에서 일어난 점프까지 페이지를
 * 잡아채면 사용자는 자기가 보던 자리를 잃는다.
 */
export function containerScrollTopFor(frame: ContainerFrame): null | number {
  const { scrollHeight, scrollTop, targetHeight, targetTop, viewport } = frame;
  // 레이아웃이 없는 환경(jsdom)과 숨은 표면은 0을 보고한다 — 잴 것이 없다.
  if (viewport <= 0) return null;
  const targetBottom = targetTop + targetHeight;
  if (targetTop >= 0 && targetBottom <= viewport) return null;
  // 여백은 뷰포트의 1/3까지만, 그리고 목적지의 **아래쪽이 잘리지 않을** 만큼만 준다.
  // 뷰포트보다 큰 목적지는 이 식에서 여백이 0이 되어 위쪽 맞춤이 된다 — 가운데 맞춤이면
  // 시작이 화면 밖으로 나가므로, 큰 블록일수록 위쪽 맞춤이 맞다.
  const lead = Math.min(
    viewport * LEAD_FRACTION,
    Math.max(0, viewport - targetHeight),
  );
  const max = Math.max(0, scrollHeight - viewport);
  const next = Math.min(Math.max(scrollTop + targetTop - lead, 0), max);
  return next === scrollTop ? null : next;
}

/**
 * 컨테이너를 찾아 목적지가 보이도록 **그 컨테이너만** 스크롤한다.
 *
 * 표시가 붙은 컨테이너가 없으면(분리된 채 마운트되는 keep-alive 에디터, 표시를 쓰지
 * 않는 단일 파일 창) 아무것도 하지 않는다.
 */
export function scrollContainerToPos(
  view: MeasurableView,
  pos: number,
  zoom = getEditorZoom(),
): void {
  const container = view.dom.closest<HTMLElement>("[data-editor-scroll]");
  if (!container) return;
  const coords = measureOrReveal(view, pos);
  if (!coords) return;
  const rect = container.getBoundingClientRect();
  const next = containerScrollTopFor({
    scrollHeight: container.scrollHeight,
    scrollTop: container.scrollTop,
    targetHeight: (coords.bottom - coords.top) / zoom,
    targetTop: (coords.top - rect.top) / zoom,
    viewport: container.clientHeight,
  });
  if (next !== null) container.scrollTop = next;
}

/** 시각 공간의 커서 사각형, 못 재면 `null`. 숨은 레이아웃은 던지지 않고 **0을 보고한다**. */
function measure(view: MeasurableView, pos: number): Coords | null {
  try {
    const coords = view.coordsAtPos(pos);
    return coords.top === 0 && coords.bottom === 0 ? null : coords;
  } catch {
    return null;
  }
}

/**
 * 재고, **실패했을 때만** 창 밖으로 밀려난 블록을 되살린 뒤 다시 잰다.
 *
 * 가상화(§perf-large-file)는 창 밖 블록을 `display: none`으로 접는다 — 큰 파일에서 점프의
 * 목적지는 대개 그 상태다. `revealBlock`은 밴드를 다시 짓는 강제 레이아웃 경로이므로
 * 잴 수 있는 목적지에는 절대 태우지 않는다.
 */
function measureOrReveal(view: MeasurableView, pos: number): Coords | null {
  const first = measure(view, pos);
  if (first) return first;
  revealBlockInActiveEditor(pos);
  return measure(view, pos);
}
