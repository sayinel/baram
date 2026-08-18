// §291 유지 표면의 스크롤 위치 기억.
//
// `display: none`은 레이아웃 박스를 파기하므로 스크롤 컨테이너의 `scrollTop`이 0이 된다. 이
// 저장소는 이미 그 사실을 보정하고 있다 — `use-tab-switching.ts`가 keep-alive 편집기(같은
// 방식으로 숨겨진다)를 위해 캐시에서 되돌린다.
//
// ‼️ 숨기기 직전에 읽는 방식은 **불가능하다.** React 커밋 순서는 (1) DOM 변경 → (2) layout
// effect cleanup/create이므로, cleanup이 도는 시점엔 이미 style이 적용돼 값이 0이다. 그래서
// 기록은 scroll 이벤트로 계속하고, 복원은 보이게 된 직후 layout effect에서 한다. 서브트리가
// 파기된 적이 없어 높이가 이미 확정돼 있으므로 타이밍 추정이 필요 없다.
//
// 브라우저가 scrollTop을 보존하는 경우에도 같은 값을 다시 쓰는 no-op이 된다 — 이 설계는
// 브라우저 거동을 확정하지 않고도 옳다.
//
// 적용 범위는 유지 표면(PDF·코드·HTML·그래프·플러그인 탭)뿐이다. 마크다운은 "같은 컨테이너에
// 다른 문서를 설치"하는 경우라 높이가 실제로 바뀌고, `use-tab-switching.ts`가 그 순서를 이미
// 다룬다. 두 기구가 같은 책임을 나눠 가지면 버그 밭이 되므로 여기서는 다루지 않는다.
import { useEffect, useLayoutEffect, useRef } from "react";

export interface TabScrollTarget {
  /** 리스너를 달 실제 스크롤 요소. CodeMirror는 `view.scrollDOM`, 나머지는 래퍼 자신. */
  element: HTMLElement;
  getScrollTop: () => number;
  setScrollTop: (n: number) => void;
}

export function useTabScrollMemory(
  tabId: string,
  active: boolean,
  resolveTarget: () => null | TabScrollTarget,
): void {
  const offsets = useRef(new Map<string, number>());
  // 매 렌더 새 클로저로 들어오는 콜백을 deps에 넣으면 리스너가 매번 재등록된다.
  const resolveRef = useRef(resolveTarget);
  resolveRef.current = resolveTarget;

  // 기록 — 스크롤이 일어날 때마다. 비활성일 때는 달지 않는다: 숨은 요소의 scrollTop은 0이라
  // 그 0을 적어 두면 복원할 값이 사라진다.
  useEffect(() => {
    if (!active) return;
    const target = resolveRef.current();
    if (!target) return;
    const { element } = target;
    const onScroll = () => offsets.current.set(tabId, target.getScrollTop());
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [active, tabId]);

  // 복원 — 보이게 된 직후, 페인트 전에.
  useLayoutEffect(() => {
    if (!active) return;
    const saved = offsets.current.get(tabId);
    if (saved === undefined) return;
    resolveRef.current()?.setScrollTop(saved);
  }, [active, tabId]);
}
