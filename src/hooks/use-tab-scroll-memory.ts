// §291 유지 표면의 스크롤 위치 기억.
//
// `display: none`은 레이아웃 박스를 파기하므로 스크롤 컨테이너의 `scrollTop`이 0이 된다. 이
// 저장소는 이미 그 사실을 보정하고 있다 — `use-tab-switching.ts`가 keep-alive 편집기(같은
// 방식으로 숨겨진다)를 위해 캐시에서 되돌린다.
//
// ‼️ 숨기기 직전에 읽는 방식은 **불가능하다.** React 커밋 순서는 (1) DOM 변경 → (2) layout
// effect cleanup/create이므로, cleanup이 도는 시점엔 이미 style이 적용돼 값이 0이다. 그래서
// 기록은 scroll 이벤트로 계속하고, 복원은 보이게 된 직후 layout effect에서 한다.
//
// 복원은 두 단계다. 마운트가 유지된 표면은 서브트리가 파기된 적이 없어 높이가 이미 확정돼
// 있으므로 그 자리에서 끝난다. 반면 상한을 넘겨 **축출됐다 다시 열린** 표면은 복원 시점에
// 내용이 없어 scrollTop이 잘리므로, 내용이 자라는 것을 관찰해 다시 놓는다(아래 effect 2).
// 어느 쪽도 시간이 조건이 아니다 — 조건은 "그 자리를 담을 만큼 자랐는가"라는 사실이다.
//
// 브라우저가 scrollTop을 보존하는 경우에도 같은 값을 다시 쓰는 no-op이 된다 — 이 설계는
// 브라우저 거동을 확정하지 않고도 옳다.
//
// 적용 범위는 유지 표면(PDF·코드·HTML·플러그인 탭)뿐이다. 마크다운은 "같은 컨테이너에 다른
// 문서를 설치"하는 경우라 높이가 실제로 바뀌고, `use-tab-switching.ts`가 그 순서를 이미
// 다룬다. 두 기구가 같은 책임을 나눠 가지면 버그 밭이 되므로 여기서는 다루지 않는다.
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

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

  /**
   * 아직 놓지 못한 오프셋. null이면 대기 중인 복원이 없다.
   *
   * ‼️ 이 값이 **effect 두 개에 걸쳐** 사는 것이 핵심이다. 예전에는 "복원했는가"를 엣지 감지
   * effect 안에서만 다뤘는데, 개발 빌드(StrictMode)는 마운트마다 effect를 create → destroy →
   * create로 돌린다. 두 번째 create는 이미 갱신된 ref를 보고 건너뛰고, 첫 번째가 만든
   * ResizeObserver는 그 사이 destroy에서 끊긴다 — 내용을 기다리는 경로가 개발 빌드에서 통째로
   * 죽었다. 상한을 넘겨 축출된 PDF가 세 차례 수정에도 맨 위로 갔던 이유가 이것이다.
   *
   * 대기를 사실로 적어 두면 관찰자를 만드는 조건이 "방금 활성이 됐는가"라는 **순간**이 아니라
   * "놓지 못한 오프셋이 있는가"라는 **상태**가 된다. 몇 번을 다시 실행해도 같은 것을 다시
   * 세운다.
   */
  const pending = useRef<null | number>(null);

  /**
   * 마지막 시도가 **우리 write로** 남겨 놓은 자리. null이면 이 에피소드에서 아직 쓴 적이 없다.
   *
   * 다음 시도에서 위치가 이것과 다르면 우리 밖의 무엇이(사용자가) 옮긴 것이다.
   *
   * ‼️ **에피소드 단위 값이다** — 훅 수명 단위가 아니다. 복원 (1)이 비활성→활성 엣지에서 null로
   * 되돌린다. 활성 구간 사이에는 표면이 숨어 scrollTop이 0으로 파기되므로, 지난 구간의 착지값과
   * 비교하는 것은 정의상 무의미하다.
   */
  const lastWritten = useRef<null | number>(null);

  /** 대기 중인 오프셋을 놓아 본다. true면 더 기다릴 것이 없다(성공했거나 대기가 없다). */
  const applyPending = useCallback((): boolean => {
    const saved = pending.current;
    if (saved === null) return true;
    const target = resolveRef.current();
    if (!target) return false;

    // ‼️ **사용자가 자리를 잡았으면 포기한다.** 아래 클램프 판정은 담을 수 없는 오프셋을
    // 영구히 대기로 남긴다 — 다른 좌표계에서 온 값(§5.1 Cmd+/), 내용이 줄어든 표면이 그렇다.
    // 그러면 자식 크기가 바뀔 때마다(오버레이 등장, 미디어 메타데이터 도착, CM6 뷰포트 재렌더)
    // 관찰자가 사용자의 스크롤을 되감아 그 자리에서 진동한다. 실앱에서 "비디오 위/아래로
    // 넘어갈 수 없다"로 나타난 것이 이 되감기다.
    //
    // 판정은 시간이 아니라 사실이다: **우리가 놓아 둔 자리에서 위치가 움직였는가.** 시도 직전에
    // 비교하므로 우리 write가 되쏘는 scroll 이벤트를 사용자 입력으로 오해할 여지가 없다.
    const before = target.getScrollTop();
    if (lastWritten.current !== null && before !== lastWritten.current) {
      pending.current = null;
      return true;
    }

    target.setScrollTop(saved);
    const landed = target.getScrollTop();
    lastWritten.current = landed;
    // 내용이 아직 그 자리를 담을 만큼 자라지 않았으면 scrollTop이 scrollHeight로 잘린다.
    if (landed < saved) return false;
    pending.current = null;
    return true;
  }, []);

  // 복원 (1) — 보이게 된 직후, 페인트 전에 한 번 시도한다.
  //
  // ‼️ **비활성→활성 엣지에서만** 되돌린다. tabId가 바뀔 때도 되돌리면, 같은 컨테이너에 다른
  // 문서를 설치하는 표면(마크다운)에서 **아직 이전 문서가 들어 있는 상태**로 새 탭의 오프셋을
  // 쓰게 된다. 그 값은 클램프되고, 클램프된 값이 scroll 이벤트로 다시 기록되어 진짜 오프셋을
  // 덮어쓴다. 그 전환의 복원은 콘텐츠 설치 뒤에 도는 use-tab-switching의 몫이다.
  useLayoutEffect(() => {
    const becameActive = active && !wasActive.current;
    wasActive.current = active;
    if (!becameActive) return;
    // ‼️ 새 복원 **에피소드**가 시작된다 — 지난 에피소드가 놓아 둔 자리는 여기서 버린다.
    // 이것을 남겨 두면 `applyPending`의 포기 판정이 **첫 write 전에** 걸린다: 숨는 동안
    // display:none이 박스를 파기해 scrollTop이 0이므로(이 파일 맨 위 참조) `before`는 항상 0인데,
    // 지난 에피소드의 착지값은 0이 아니다 → 매번 "사용자가 옮겼다"로 오판해 아무것도 쓰지 않고
    // 포기한다. `pending`이 지워지므로 **복원 (2)의 관찰자도 무장하지 못한다** — 늦게 도착하는
    // 내용을 기다리는 경로가 두 번째 활성화부터 통째로 죽는다.
    //
    // MarkdownSurface가 이 함정에 정확히 걸린다: App은 그것을 **앱 수명 동안 한 인스턴스**로
    // 렌더하고 `tabId={activeTabId}`만 갈아 끼우므로(App.tsx의 MarkdownSurface 렌더),
    // 이 ref가 탭도 에피소드도 넘나들며 살아남는다. TabSurface는
    // `${entry.kind}-${entry.tabId}`로 키가 갈려 있어(App.tsx의 retained-tab 맵 렌더)
    // 우연히 무사했다.
    lastWritten.current = null;
    // ‼️ 조건부로 **덮어쓴다.** 저장된 값이 없을 때 예전 대기를 그대로 두면, 아래 관찰자가
    // 지난 활성 구간에서 못 놓은 낡은 오프셋을 되살린다.
    const saved = offsets.current.get(tabId);
    pending.current = saved !== undefined && saved > 0 ? saved : null;
    applyPending();
  }, [active, applyPending, offsets, tabId]);

  // 복원 (2) — 대기가 남아 있는 동안 내용이 도착하는 것을 관찰한다.
  //
  // 여기까지 오는 것은 축출됐다 다시 열린 표면이다. PDF는 이 시점에 페이지가 하나도 렌더되지
  // 않아 문서 높이가 컨테이너 높이 그대로다(실앱에서 상한 밖 PDF가 맨 위로 갔다).
  //
  // 기다리는 방법은 타이머가 아니라 사실 관찰이다. 두 가지 사실을 본다:
  //  - 스크롤 컨테이너 자신은 내용이 늘어도 크기가 그대로이므로 **자식들**의 크기를 본다.
  //  - 복원 시점에 자식이 아예 없을 수 있다(Suspense fallback=null). 그래서 **자식이 생기는
  //    것**까지 봐야 한다 — 이것이 없으면 관찰 대상이 0개인 채 영원히 기다린다.
  useEffect(() => {
    if (!active || pending.current === null) return;
    const target = resolveRef.current();
    if (!target) return;
    const { element } = target;

    const growth = new ResizeObserver(() => {
      if (!applyPending()) return;
      growth.disconnect();
      children.disconnect();
    });
    // observe()는 같은 요소에 여러 번 불러도 무해하므로 자식이 바뀔 때마다 통째로 다시 건다.
    const observeChildren = () => {
      for (const child of Array.from(element.children)) growth.observe(child);
    };
    const children = new MutationObserver(observeChildren);
    children.observe(element, { childList: true });
    observeChildren();

    return () => {
      growth.disconnect();
      children.disconnect();
    };
  }, [active, applyPending, tabId]);
}
