// §308 M3-a 칩을 눌러 값을 고친다 — 이 파일은 **클릭만** 맡는다.
//
// 고르고 쓰는 일은 `task-field-edit.ts`에 있다. 슬래시 커맨드(M3-b)가 같은 값을 같은
// 규칙으로 고쳐야 하므로 진입점만 여기 둘, 그 뒤는 하나다.

import type { TaskFieldKind } from "../../utils/tasks/task-field-order";
import type { EditorView } from "@tiptap/pm/view";

import {
  askTaskField,
  captureParagraphAt,
  commitTaskField,
} from "./task-field-edit";

/** 칩 DOM이 자기 정체를 말하는 두 속성 — **위치가 아니다**(위치는 곧 낡는다). */
export const CHIP_KIND_ATTR = "data-chip-kind";
export const CHIP_VALUE_ATTR = "data-chip-value";

/**
 * 칩 클릭. 처리했으면 `true` — ProseMirror가 그 위에 자기 선택 처리를 얹지 않는다.
 *
 * ‼️ `click`이 아니라 `mousedown`인 것이 요건이다. `click`까지 기다리면 그 사이에 캐럿이
 * 옮겨가고, 캐럿이 이 줄에 들어오는 순간 데코레이션이 통째로 사라져 **누른 그 칩이
 * 포인터 아래에서 없어진다.** 사용자에게는 "눌렀더니 사라졌다"가 되고 다음 클릭 대상도
 * 없다. 그래서 `preventDefault()`도 선택이 아니라 요건이다.
 *
 * 비동기 부분(모달)은 의도적으로 기다리지 않는다. `handleDOMEvents`는 동기 boolean을
 * 요구하고, 모달이 닫힐 때까지 이벤트 처리를 붙잡고 있을 이유도 없다.
 */
export function handleChipMouseDown(
  view: EditorView,
  event: MouseEvent,
): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const chip = target.closest<HTMLElement>(".task-chip");
  if (!chip || !view.dom.contains(chip)) return false;

  const kind = chip.getAttribute(CHIP_KIND_ATTR) as null | TaskFieldKind;
  const value = chip.getAttribute(CHIP_VALUE_ATTR);
  if (kind === null || value === null) return false;

  event.preventDefault();

  const line = captureParagraphAt(view, chip);
  if (!line) return true;

  void askTaskField(kind, value).then((next) => {
    // 값까지 넘기는 이유: 한 줄에 같은 종류가 둘일 수 있고, 그때 고쳐야 하는 것은
    // 종류의 첫 번째가 아니라 **누른 그것**이다.
    if (next !== null) commitTaskField(view, line, kind, next, value);
  });
  return true;
}
