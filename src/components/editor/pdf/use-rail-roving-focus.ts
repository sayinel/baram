// §282.4 레일 목록의 roving tabindex — 목록 전체를 **탭 정지점 하나**로 만든다.
//
// 왜 필요한가: 목록 항목이 전부 평범한 <button>이면 Tab 정지점이 항목 수만큼
// 생긴다. 300페이지 문서에서 레일에 들어가면 Tab을 300번 눌러야 빠져나온다
// (사용자가 실제로 그 자리를 밟았다: 마지막 썸네일에서 Tab을 누르니 툴바가
// 아니라 상태 표시줄로 갔다 — 툴바는 DOM에서 레일보다 앞이라 Shift+Tab 쪽에
// 있었고, 앞으로 가는 Tab은 목록을 다 지난 뒤 레일 밖으로 나간 것이다).
//
// 표준 listbox/toolbar 패턴: 항목 하나만 tabIndex=0이고 나머지는 -1, 목록
// 안에서는 화살표로 이동한다. 그러면 Tab 한 번으로 목록에 들어가고 Tab 한
// 번으로 나간다.
import type { KeyboardEvent, RefObject } from "react";
import { useCallback, useState } from "react";

export interface RailRovingFocus {
  /** 컨테이너에 붙일 keydown 핸들러 — 화살표/Home/End를 소비한다. */
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  /** tabIndex=0을 받을 항목의 키. 목록이 비었으면 null. */
  rovingKey: null | string;
}

/**
 * @param keys 목록의 항목 키들, 표시 순서 그대로.
 * @param preferredKey 사용자가 아직 목록을 조작하지 않았을 때 tabIndex=0을 줄
 *   항목(페이지 목록이면 현재 페이지). 목록에 없으면 무시된다.
 * @param containerRef 항목 엘리먼트를 찾을 범위.
 * @param keyAttr 항목 엘리먼트가 자기 키를 담고 있는 속성 이름.
 */
export function useRailRovingFocus(
  keys: string[],
  preferredKey: null | string,
  containerRef: RefObject<HTMLElement | null>,
  keyAttr: string,
): RailRovingFocus {
  // null = "아직 사용자가 고르지 않음" — 그동안은 preferredKey를 따른다.
  // 페이지 목록에서 이게 중요하다: 본문을 스크롤하면 tabIndex=0이 현재 페이지를
  // 따라다녀야, Tab으로 레일에 들어갔을 때 지금 보고 있는 페이지에서 시작한다.
  const [picked, setPicked] = useState<null | string>(null);

  const rovingKey =
    (picked !== null && keys.includes(picked) ? picked : null) ??
    (preferredKey !== null && keys.includes(preferredKey)
      ? preferredKey
      : null) ??
    keys[0] ??
    null;

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (keys.length === 0) return;
      const current = rovingKey === null ? -1 : keys.indexOf(rovingKey);
      let next: number;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        next = Math.min(current + 1, keys.length - 1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        next = Math.max(current - 1, 0);
      } else if (e.key === "Home") {
        next = 0;
      } else if (e.key === "End") {
        next = keys.length - 1;
      } else {
        return;
      }

      // ‼️ preventDefault가 필요하다. 화살표를 그냥 두면 레일 본문이 함께
      // 스크롤되어 방금 포커스한 항목이 화면에서 밀려난다.
      e.preventDefault();
      const nextKey = keys[next];
      setPicked(nextKey);
      // 포커스를 실제로 옮긴다 — tabIndex만 바꾸면 화면에 아무 일도 일어나지
      // 않아 키보드 사용자에게는 아무 반응이 없는 것과 같다.
      containerRef.current
        ?.querySelector<HTMLElement>(`[${keyAttr}="${nextKey}"]`)
        ?.focus();
    },
    [containerRef, keyAttr, keys, rovingKey],
  );

  return { onKeyDown, rovingKey };
}
