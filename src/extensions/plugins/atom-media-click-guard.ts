// §295 미디어 atom 클릭 가드 — image.ts에서 추출. 동작 변경 없음.
//
// 원 주석(image.ts §5.1)을 그대로 옮긴다:
//   문제: 트랙패드 탭/클릭이 마우스를 4px 넘게 움직여 PM이 allowDefault=true로 보고
//     selectClickedLeaf를 건너뛴다 → atom에 NodeSelection이 생기지 않는다.
//   또한 NodeView는 onMouseDown + stopPropagation()을 써서는 안 된다. React 18이
//     #root에 캡처 단계 리스너를 달아 PM으로 가는 이벤트를 막기 때문이다.
//   전략:
//     mousedown — DOM으로 클릭 대상을 찾아 NodeSelection을 디스패치.
//     createSelectionBetween — DOMObserver를 가로채 SyntaxReveal이 확장할 때까지
//       TextSelection이 아니라 NodeSelection을 반환.
import type { EditorView } from "@tiptap/pm/view";

import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from "@tiptap/pm/state";

import { getSyntaxRevealExpanded } from "./syntax-reveal";

export interface AtomMediaClickGuardOptions {
  /** 클릭이 이 셀렉터에 걸리면 가드가 관여하지 않는다 (툴바·캡션 등). */
  excludeSelectors: string[];
  /** 클릭 대상 tagName이 여기 있으면 가드가 관여하지 않는다. */
  excludeTagNames: string[];
  nodeName: string;
  wrapperClass: string;
}

export function createAtomMediaClickGuard(
  options: AtomMediaClickGuardOptions,
): Plugin {
  const { excludeSelectors, excludeTagNames, nodeName, wrapperClass } = options;
  const pluginKey = new PluginKey(`${nodeName}ClickGuard`);

  // 어느 노드가 클릭됐는지: mousedown이 쓰고 createSelectionBetween이 읽는다.
  let clickedPos: null | number = null;
  let clickedTimer: null | ReturnType<typeof setTimeout> = null;

  /** DOM 순서로 N번째 노드의 PM 위치를 찾는다. */
  const findNodePos = (view: EditorView, wrapperIdx: number): number => {
    let found = -1;
    let count = 0;
    view.state.doc.descendants((node, pos) => {
      if (found >= 0) return false; // §perf-large-file: early exit
      if (node.type.name === nodeName) {
        if (count === wrapperIdx) {
          found = pos;
          return false;
        }
        count++;
      }
    });
    return found;
  };

  const isExcluded = (target: HTMLElement): boolean =>
    excludeSelectors.some((sel) => target.closest(sel)) ||
    excludeTagNames.includes(target.tagName);

  return new Plugin({
    key: pluginKey,

    props: {
      // DOMObserver의 선택 생성을 가로채, SyntaxReveal이 펼쳐질 때까지(RAF, ~16ms)
      // TextSelection이 아니라 NodeSelection을 유지한다.
      createSelectionBetween(view) {
        if (clickedPos === null) return null;
        const pos = clickedPos;
        clickedPos = null;
        if (clickedTimer) {
          clearTimeout(clickedTimer);
          clickedTimer = null;
        }
        try {
          if (view.state.doc.resolve(pos).nodeAfter?.type.name === nodeName) {
            return NodeSelection.create(view.state.doc, pos);
          }
        } catch {
          /* ignore */
        }
        return null;
      },

      handleDOMEvents: {
        mousedown(view, event) {
          if (event.button !== 0) return false;

          const target = event.target as HTMLElement;
          let wrapper = target.closest(
            `.${wrapperClass}`,
          ) as HTMLElement | null;

          // 좌표 기반 폴백: WebKit이 event.target을 잘못 보고할 수 있다.
          if (!wrapper) {
            for (const el of view.dom.querySelectorAll(`.${wrapperClass}`)) {
              const rect = el.getBoundingClientRect();
              if (
                rect.width > 0 &&
                rect.height > 0 &&
                event.clientX >= rect.left &&
                event.clientX <= rect.right &&
                event.clientY >= rect.top &&
                event.clientY <= rect.bottom
              ) {
                wrapper = el as HTMLElement;
                break;
              }
            }
          }

          if (wrapper && !isExcluded(target)) {
            const all = view.dom.querySelectorAll(`.${wrapperClass}`);
            let wrapperIdx = -1;
            for (let i = 0; i < all.length; i++) {
              if (all[i] === wrapper) {
                wrapperIdx = i;
                break;
              }
            }
            const pos = wrapperIdx >= 0 ? findNodePos(view, wrapperIdx) : -1;

            if (wrapperIdx >= 0 && pos >= 0) {
              try {
                clickedPos = pos;
                if (clickedTimer) clearTimeout(clickedTimer);
                clickedTimer = setTimeout(() => {
                  clickedPos = null;
                  clickedTimer = null;
                }, 500);

                event.preventDefault();
                view.dispatch(
                  view.state.tr.setSelection(
                    NodeSelection.create(view.state.doc, pos),
                  ),
                );
                view.focus();
                return true;
              } catch {
                clickedPos = null;
              }
            }
          }

          // SyntaxReveal이 이 노드의 원문을 펼쳐 둔 상태에서 그 밖을 클릭했다면
          // TextSelection을 명시적으로 디스패치한다. 없으면 collapse 이후 WebKit의
          // 네이티브 선택 처리가 상한 선택을 만들어 커서가 노드 옆에 붙어버린다.
          const expanded = getSyntaxRevealExpanded(view.state);
          if (expanded?.kind === "image") {
            const coords = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            if (
              coords &&
              (coords.pos < expanded.from || coords.pos > expanded.to)
            ) {
              try {
                const $pos = view.state.doc.resolve(coords.pos);
                event.preventDefault();
                view.dispatch(
                  view.state.tr.setSelection(TextSelection.near($pos)),
                );
                view.focus();
                return true;
              } catch {
                /* fall through to default PM handling */
              }
            }
          }

          return false;
        },
      },
    },
  });
}
