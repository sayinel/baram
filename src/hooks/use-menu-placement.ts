// §312 뜬 메뉴를 화면 안으로 끌어들이는 배선.
//
// 좌표를 정하는 것은 `utils/menu-placement.ts`의 순수 함수다. 이 훅이 맡는 것은 그
// 함수가 필요로 하는 **측정**이다: 메뉴의 크기는 열기 전에 알 수 없다 — 아직 렌더되지
// 않았고, 항목 라벨이 감기는 정도에 따라 높이가 달라진다(비활성 `#someday` 항목의
// 라벨은 문장 하나다). 그래서 배치는 렌더 **뒤에** 재서 고친다.
//
// `useEffect`가 아니라 `useLayoutEffect`인 것이 핵심이다: paint 전에 고쳐야 잘린
// 자리에 한 프레임 번쩍이지 않는다.
import { useLayoutEffect, useRef, useState } from "react";

import type { MenuAnchor } from "../utils/menu-placement";

import { placeMenu } from "../utils/menu-placement";

/**
 * 메뉴 컨테이너에 붙일 ref와, 거기에 그대로 쓰면 되는 좌표.
 *
 * 첫 렌더는 앵커 좌표 그대로 나가고(측정할 것이 아직 없다) 레이아웃 이펙트가 고친다.
 * `anchor`를 매 렌더 새 객체로 넘겨도 안전하다 — 의존성은 세 숫자이고, 결과가 같으면
 * 상태를 갈지 않는다(같은 좌표로 setState를 반복하면 렌더 루프가 된다).
 */
export function useMenuPlacement<T extends HTMLElement>(
  anchor: MenuAnchor,
): { position: { x: number; y: number }; ref: React.RefObject<null | T> } {
  const { bottom, left, top } = anchor;
  const ref = useRef<null | T>(null);
  const [position, setPosition] = useState({ x: left, y: bottom });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const next = placeMenu(
      { bottom, left, top },
      { height: box.height, width: box.width },
      { height: window.innerHeight, width: window.innerWidth },
    );
    setPosition((prev) =>
      prev.x === next.x && prev.y === next.y ? prev : next,
    );
  }, [bottom, left, top]);

  return { position, ref };
}
