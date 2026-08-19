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
import type { MutableRefObject } from "react";
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
  /**
   * 외부 오프셋 맵. 기록자와 복원자가 다른 표면이 쓴다.
   *
   * 마크다운이 그렇다: 기록은 여기(scroll 이벤트)에서 하지만, **탭이 바뀌는** 전환의 복원은
   * 콘텐츠 설치 뒤에 도는 use-tab-switching이 해야 한다. 둘이 같은 맵을 봐야 한다.
   */
  externalOffsets?: MutableRefObject<Map<string, number>>,
): void {
  const ownOffsets = useRef(new Map<string, number>());
  const offsets = externalOffsets ?? ownOffsets;
  // 직전 active 값 — 복원은 비활성→활성 **엣지**에서만 일어난다(아래 참조).
  //
  // ‼️ `false`로 시작한다. 상한을 넘겨 축출된 표면은 다시 열릴 때 **새로 마운트**되는데,
  // `active`로 시작하면 엣지가 없어 저장해 둔 자리를 못 되돌린다. 저장된 값이 없으면 어차피
  // 아무것도 하지 않으므로 첫 마운트를 엣지로 쳐도 손해가 없다.
  const wasActive = useRef(false);
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
    const onScroll = () => {
      offsets.current.set(tabId, target.getScrollTop());
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [active, offsets, tabId]);

  // 복원 — 보이게 된 직후, 페인트 전에.
  //
  // ‼️ **비활성→활성 엣지에서만** 되돌린다. tabId가 바뀔 때도 되돌리면, 같은 컨테이너에 다른
  // 문서를 설치하는 표면(마크다운)에서 **아직 이전 문서가 들어 있는 상태**로 새 탭의 오프셋을
  // 쓰게 된다. 그 값은 클램프되고, 클램프된 값이 scroll 이벤트로 다시 기록되어 진짜 오프셋을
  // 덮어쓴다. 그 전환의 복원은 콘텐츠 설치 뒤에 도는 use-tab-switching의 몫이다.
  useLayoutEffect(() => {
    const becameActive = active && !wasActive.current;
    wasActive.current = active;
    if (!becameActive) return;
    const saved = offsets.current.get(tabId);
    if (saved === undefined || saved <= 0) return;

    const apply = (): boolean => {
      const target = resolveRef.current();
      if (!target) return false;
      target.setScrollTop(saved);
      return target.getScrollTop() >= saved;
    };
    if (apply()) return;

    // ‼️ 여기까지 왔다는 것은 **내용이 아직 그 자리를 담을 만큼 자라지 않았다**는 뜻이다.
    // scrollTop이 scrollHeight로 잘렸다. 축출됐다 다시 열린 표면이 그렇다 — PDF는 이 시점에
    // 페이지가 하나도 렌더되지 않아 문서 높이가 0이다(실앱에서 상한 밖 PDF가 맨 위로 갔다).
    //
    // 기다리는 방법은 타이머가 아니라 사실 관찰이다: 내용이 자라면 다시 놓는다. 스크롤
    // 컨테이너 자신은 내용이 늘어도 크기가 그대로이므로, **자식들**을 관찰해야 한다.
    const target = resolveRef.current();
    if (!target) return;
    const observer = new ResizeObserver(() => {
      if (apply()) observer.disconnect();
    });
    for (const child of Array.from(target.element.children)) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [active, offsets, tabId]);
}
